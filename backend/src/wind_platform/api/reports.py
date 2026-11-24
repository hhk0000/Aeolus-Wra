"""Local Word report downloads. Uploaded templates and charts are request-scoped."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from wind_platform.core.calculations import CalculationError
from wind_platform.services.report_catalog import catalog, release
from wind_platform.services.word_report import MAX_FIGURES, MIB, ReportManifest, build_report

router = APIRouter(tags=["reports"])
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.post("/reports/docx", response_class=Response, responses={200: {"content": {DOCX: {}}}})
async def export_word(request: Request):
    async with request.form(max_files=MAX_FIGURES + 1, max_fields=1, max_part_size=8 * MIB) as form:
        raw = form.get("manifest")
        if not isinstance(raw, str):
            raise CalculationError("请提供报告成果清单。")
        try:
            manifest = ReportManifest.model_validate_json(raw)
        except ValidationError as exc:
            raise CalculationError("报告清单格式无效，请检查运行编号、图表和表格维度。") from exc
        images = form.getlist("images")
        if any(not isinstance(i, UploadFile) for i in images):
            raise CalculationError("图表须上传为 PNG 文件。")
        if (
            len(images) > MAX_FIGURES
            or any(i.size > 6 * MIB for i in images)
            or sum(i.size for i in images) > 96 * MIB
        ):
            raise HTTPException(413, "单图上限 6 MB，图表合计上限 96 MB、256 张。")
        template = form.get("template")
        if template is not None:
            if not isinstance(template, UploadFile):
                raise CalculationError("模板应为 Word .docx 文件。")
            if template.size > 128 * MIB:
                raise HTTPException(413, "Word 模板上限 128 MB。")
        try:
            report = await run_in_threadpool(
                build_report,
                request.app.state.wind_store,
                manifest,
                [i.file for i in images],
                template.file if template is not None else None,
            )
        except CalculationError:
            raise
        except ValueError as exc:
            raise CalculationError("图表或文本包含 Word 无法识别的内容。") from exc
    return Response(
        report,
        media_type=DOCX,
        headers={"Content-Disposition": 'attachment; filename="wind-resource-report.docx"'},
    )


@router.get("/reports/templates")
def report_templates():
    return [
        {"id": key, "title": item["title"], "version": item["active"]}
        for key, item in catalog().items()
    ]


@router.get("/reports/templates/{key}/{version}/source")
def report_template_source(key: str, version: str):
    data, _ = release(key, version)
    return Response(
        data,
        media_type=DOCX,
        headers={"Content-Disposition": 'attachment; filename="template.docx"'},
    )


@router.post("/reports/templates/{key}/{version}/export")
async def export_registered(key: str, version: str, request: Request):
    data, render = release(key, version)
    async with request.form(max_files=2, max_fields=8) as form:
        upload = form.get("data")
        if not isinstance(upload, UploadFile) or upload.size is None or upload.size > 64 * MIB:
            raise CalculationError("请选择不超过64 MB的逐小时中尺度TXT。")
        try:
            density = float(str(form.get("density", "")))
            factor = float(str(form.get("factor", "75")))
        except ValueError as exc:
            raise CalculationError("请填写有效的空气密度和综合修正系数。") from exc
        if not 0 < density < 3 or not 0 < factor <= 100:
            raise CalculationError("空气密度须在0至3之间，综合修正系数须大于0且不超过100%。")
        energy = form.get("energy")
        if energy is not None and (
            not isinstance(energy, UploadFile) or energy.size is None or energy.size > 4 * MIB
        ):
            raise CalculationError("发电量表不得超过4 MB。")
        location = {}
        for key, label, lo, hi in (
            ("lat", "纬度", -90, 90),
            ("lon", "经度", -180, 180),
            ("alt", "海拔高度", -500, 9000),
        ):
            value = str(form.get(key, "")).strip()
            if value:
                try:
                    if not lo <= float(value) <= hi:
                        raise ValueError()
                except ValueError as exc:
                    raise CalculationError(f"{label}超出有效范围。") from exc
                location[label] = value
        result = await run_in_threadpool(
            render,
            data,
            await upload.read(),
            density,
            str(form.get("project", "")).strip()[:120],
            factor,
            await energy.read() if energy else None,
            location,
        )
    return Response(
        result,
        media_type=DOCX,
        headers={
            "Content-Disposition": 'attachment; filename="mesoscale-report.docx"',
            "X-Report-Template": f"{key}/{version}",
        },
    )
