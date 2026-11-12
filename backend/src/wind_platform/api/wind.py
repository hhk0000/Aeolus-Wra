"""Thin local API adapter. The calculation modules have no FastAPI dependency."""

import csv
from datetime import UTC, datetime
from io import StringIO
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from wind_platform.core.calculations import CalculationError, extreme_gumbel
from wind_platform.core.ingestion import (
    RULES,
    ParseOptions,
    dataset_summary,
    parse_dataset,
    preview,
)
from wind_platform.core.standards import ENGINE_VERSION, registry
from wind_platform.services.analysis import (
    AnalysisOptions,
    CorrelationOptions,
    LongTermOptions,
    run_analysis,
    run_correlation,
    run_long_term,
)
from wind_platform.services.processing import ProcessingOptions, process
from wind_platform.services.review import ReviewOptions, review

router = APIRouter(tags=["wind-resource"])
MAX_FILE_BYTES = 32 * 1024 * 1024


def store(request):
    return request.app.state.wind_store


@router.get("/standards")
def standards_registry():
    return registry()


@router.get("/channel-rules")
def channel_rules():
    return RULES


@router.post("/files")
async def upload(
    request: Request,
    file: Annotated[UploadFile, File()],
    stage: Annotated[str, Form()],
    tower_id: Annotated[str, Form()],
):
    if stage not in {"raw", "qc", "result", "reference"}:
        raise HTTPException(422, "数据阶段无效。")
    content = await file.read(MAX_FILE_BYTES + 1)
    await file.close()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "首版单文件限制32MB，请按连续时段拆分。")
    result = preview(content)
    local = store(request)
    sha = local.original(content)
    saved = local.put(
        "files",
        {
            "sha256": sha,
            "filename": (file.filename or "data.txt")[:240],
            "stage": stage,
            "tower_id": tower_id[:120],
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    return {**saved, **result}


class PreviewOptions(BaseModel):
    header_line: int = Field(ge=1)
    delimiter: str


@router.post("/files/{id_}/preview")
def file_preview(id_: str, config: PreviewOptions, request: Request):
    local = store(request)
    meta = local.get("files", id_)
    return {
        **meta,
        **preview(local.read_original(meta["sha256"]), config.header_line, config.delimiter),
    }


@router.post("/files/{id_}/parse")
def parse_file(id_: str, config: ParseOptions, request: Request):
    local = store(request)
    meta = local.get("files", id_)
    data = parse_dataset(local.read_original(meta["sha256"]), config)
    saved = local.put(
        "datasets",
        {
            **data,
            "file_id": id_,
            "sha256": meta["sha256"],
            "filename": meta["filename"],
            "stage": meta["stage"],
            "tower_id": meta["tower_id"],
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    return dataset_summary(saved)


@router.get("/datasets/{id_}")
def get_dataset(id_: str, request: Request):
    return dataset_summary(store(request).get("datasets", id_))


def csv_response(rows, filename):
    stream = StringIO(newline="")
    if rows:
        keys = list(dict.fromkeys(key for row in rows for key in row if key != "points"))
        writer = csv.DictWriter(stream, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            # Prevent spreadsheet formula execution in user-controlled text labels.
            safe = {
                key: "'" + value
                if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}
                else value
                for key, value in row.items()
            }
            writer.writerow(safe)
    return Response(
        "\ufeff" + stream.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/datasets/{id_}/export.csv")
def export_dataset(id_: str, request: Request):
    data = store(request).get("datasets", id_)
    rows = [
        {
            "timestamp_utc_interval_start": stamp,
            **{f"{c['id']} {c['name']} (SI)": c["values"][i] for c in data["channels"]},
        }
        for i, stamp in enumerate(data["timestamps"])
    ]
    return csv_response(rows, f"dataset_{id_}.csv")


@router.post("/analysis")
def analyze(config: AnalysisOptions, request: Request):
    return run_analysis(store(request), config)


@router.post("/correlations")
def correlate(config: CorrelationOptions, request: Request):
    return run_correlation(store(request), config)


@router.post("/long-term")
def long_term(config: LongTermOptions, request: Request):
    return run_long_term(store(request), config)


@router.post("/processing")
def process_dataset(config: ProcessingOptions, request: Request):
    return dataset_summary(process(store(request), config))


@router.post("/reviews")
def review_dataset(config: ReviewOptions, request: Request):
    return review(store(request), config)


class ExtremeOptions(BaseModel):
    years: list[int] = Field(min_length=10, max_length=200)
    annual_maxima: list[Annotated[float, Field(gt=0, le=150)]] = Field(
        min_length=10, max_length=200
    )
    return_period: float = Field(default=50, gt=1, le=1000)
    interpolate_coefficients: bool = False
    averaging_minutes: int = 10
    homogeneous_annual_maxima_confirmed: bool = False


@router.post("/extremes")
def extremes(config: ExtremeOptions, request: Request):
    if len(config.years) != len(config.annual_maxima) or any(
        b != a + 1 for a, b in zip(config.years, config.years[1:], strict=False)
    ):
        raise CalculationError("年最大序列必须每年一值、年份连续且升序。")
    if config.averaging_minutes != 10 or not config.homogeneous_annual_maxima_confirmed:
        raise CalculationError("请确认输入为独立、同质、连续年度最大10min平均风速。")
    result = extreme_gumbel(
        config.annual_maxima, config.return_period, config.interpolate_coefficients
    )
    return store(request).put(
        "runs",
        {
            "kind": "extreme",
            "engine_version": ENGINE_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "config": config.model_dump(),
            "outputs": {
                "extreme": {
                    "title": "极值I型年最大风速估计",
                    "method": "extreme-gumbel",
                    "status": "ready",
                    "rows": [
                        {"year": y, "maximum_10min": v}
                        for y, v in zip(config.years, config.annual_maxima, strict=True)
                    ],
                    "summary": result,
                }
            },
        },
    )


@router.get("/runs/{id_}")
def get_run(id_: str, request: Request):
    return store(request).get("runs", id_)


@router.get("/runs/{id_}/tables/{output_id}.csv")
def export_table(id_: str, output_id: str, request: Request):
    run = store(request).get("runs", id_)
    output = run.get("outputs", {}).get(output_id)
    if not output or output["status"] != "ready":
        raise CalculationError("没有可导出的该项计算成果。")
    return csv_response(output.get("rows", []), f"{output_id}_{id_}.csv")
