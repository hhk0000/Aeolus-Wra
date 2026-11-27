"""Local Word report downloads. Uploaded templates and charts are request-scoped."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from wind_platform.core.calculations import CalculationError
from wind_platform.services import assessment_extreme, mesoscale_report, pressure_location
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


def assessment_file(local, file_id, kind):
    record = local.get("assessment-files", file_id)
    if record["kind"] != kind:
        raise CalculationError("上传文件用途不匹配。")
    return local.read_original(record["sha256"])


@router.post("/reports/assessment/files/{kind}")
async def upload_assessment_file(kind: str, request: Request):
    limits = {"source": 64 * MIB, "thunderstorm": 64 * MIB, "energy": 4 * MIB, "pressure": 4 * MIB}
    if kind not in limits:
        raise CalculationError("资料类型无效。")
    async with request.form(max_files=1, max_fields=0) as form:
        file = form.get("file")
        if not isinstance(file, UploadFile) or not file.size or file.size > limits[kind]:
            raise CalculationError(
                "请选择有效的资料，风速 TXT 不超过64 MB，机组表和风压库不超过4 MB。"
            )
        raw = await file.read()
        detail = {}
        if kind == "source":
            detail = await run_in_threadpool(mesoscale_report.assessment_source, raw)
        elif kind == "thunderstorm":
            detail = await run_in_threadpool(mesoscale_report.assessment_source, raw, True)
            if detail["interval_minutes"] != 10:
                raise CalculationError("五日雷暴法资料须为 10 分钟步长。")
            if detail["coverage_error"]:
                raise CalculationError(detail["coverage_error"])
        elif kind == "pressure":
            detail = {
                "stations": await run_in_threadpool(assessment_extreme.pressure_stations, raw)
            }
        local = request.app.state.wind_store
        return local.put(
            "assessment-files",
            {
                **detail,
                "kind": kind,
                "name": file.filename or "资料",
                "sha256": local.original(raw),
            },
        )


@router.get("/reports/assessment/files/source/{file_id}")
def get_assessment_source(file_id: str, request: Request):
    local = request.app.state.wind_store
    record = local.get("assessment-files", file_id)
    if record["kind"] != "source":
        raise CalculationError("上传文件用途不匹配。")
    if {
        "density_by_year",
        "temperature_by_year",
        "window_years",
        "interval_minutes",
        "missing_speed_count",
        "year_coverage",
    } <= record.keys():
        return record
    return {
        **record,
        **mesoscale_report.assessment_source(local.read_original(record["sha256"])),
    }


@router.get("/reports/assessment/files/pressure/{file_id}")
def get_pressure_library(file_id: str, request: Request):
    record = request.app.state.wind_store.get("assessment-files", file_id)
    if record["kind"] != "pressure":
        raise CalculationError("上传文件用途不匹配。")
    return record


@router.get("/reports/assessment/pressure-match")
def get_pressure_match(place: str = ""):
    station, provinces = pressure_location.pressure_lookup(place[:120])
    return {"station": station, "candidate_provinces": provinces}


class ThunderstormOptions(BaseModel):
    source_id: str | None = None
    year: int | None = Field(default=None, ge=1, le=9998)
    c1: float = Field(gt=0, allow_inf_nan=False)
    c2: float = Field(allow_inf_nan=False)


class ExtremeOptions(BaseModel):
    multiplier: float = Field(
        default=assessment_extreme.DEFAULT_MULTIPLIER, gt=0, allow_inf_nan=False
    )
    pressure_library_id: str | None = None
    pressure_station_index: int | None = Field(default=None, ge=0)
    place: str = Field(default="", max_length=120)
    pressure_override: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    thunderstorm: ThunderstormOptions | None = None

    def calculation_options(self, local, *, for_export=False):
        station = self.station(local)
        if for_export and station is None:
            raise CalculationError("风压库未匹配到基本风压，请在分析配置中手填后再导出。")
        thunderstorm_raw = None
        if self.thunderstorm and self.thunderstorm.source_id:
            thunderstorm_raw = assessment_file(local, self.thunderstorm.source_id, "thunderstorm")
        return {
            "extreme_multiplier": self.multiplier,
            "pressure_station": station,
            "thunderstorm_options": self.thunderstorm,
            "thunderstorm_raw": thunderstorm_raw,
        }

    def station(self, local):
        station = (
            pressure_location.match_pressure(self.place)
            if self.place.strip()
            else self.legacy_station(local)
        )
        if station and self.place.strip():
            station = {**station, "requested_place": self.place.strip()}
        if self.pressure_override is None:
            return station
        if not assessment_extreme.valid_pressure(self.pressure_override):
            raise CalculationError("手填风压过大，无法换算参考风速。")
        return {
            **(station or {"name": self.place.strip() or "手动填写"}),
            "pressure": self.pressure_override,
            "manual": True,
            "matched_pressure": station["pressure"] if station else None,
        }

    def legacy_station(self, local):
        if self.pressure_station_index is None:
            return None
        if not self.pressure_library_id:
            raise CalculationError("请选择风压库。")
        record = local.get("assessment-files", self.pressure_library_id)
        if record["kind"] != "pressure":
            raise CalculationError("上传文件用途不匹配。")
        if self.pressure_station_index >= len(record["stations"]):
            raise CalculationError("所选风压站点不存在。")
        return {
            **record["stations"][self.pressure_station_index],
            "library": record["name"],
            "sha256": record["sha256"],
        }


class AssessmentHeights(BaseModel):
    hub_height_m: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    mean_temperature_c: float | None = Field(default=None, ge=-100, le=100)
    wind_shear_exponent: float | None = Field(default=None, allow_inf_nan=False)


class AssessmentOptions(AssessmentHeights):
    source_id: str
    density: float = Field(gt=0, lt=3)
    analysis_year: int | None = None
    extreme: ExtremeOptions = Field(default_factory=ExtremeOptions)


@router.post("/reports/assessment/runs")
def run_assessment(options: AssessmentOptions, request: Request):
    local = request.app.state.wind_store
    raw = assessment_file(local, options.source_id, "source")
    results = mesoscale_report.build(
        None,
        raw,
        options.density,
        "",
        analysis_year=options.analysis_year,
        hub_height_m=options.hub_height_m,
        mean_temperature_c=options.mean_temperature_c,
        wind_shear_exponent=options.wind_shear_exponent,
        **options.extreme.calculation_options(local),
    )
    saved = local.put("assessment-runs", {**results, "calculation_options": options.model_dump()})
    return {"id": saved["id"]}


@router.get("/reports/assessment/runs/{run_id}")
def get_assessment(run_id: str, request: Request):
    run = request.app.state.wind_store.get("assessment-runs", run_id)
    extreme = run.get("extreme")
    if extreme and "pressure_site" not in extreme:
        extreme["pressure_site"] = assessment_extreme.pressure_site_speed(
            extreme["pressure_standard"], extreme["density"]
        )
    if extreme and "wind_speed_class" not in extreme:
        extreme["wind_speed_class"] = assessment_extreme.reference_wind_class(extreme["adopted"])
    return run


@router.post("/reports/templates/{key}/{version}/export")
async def export_registered(key: str, version: str, request: Request):
    data, render = release(key, version)
    async with request.form(max_files=2, max_fields=16) as form:
        upload = form.get("data")
        source_id = form.get("source_id")
        local = request.app.state.wind_store
        if isinstance(source_id, str) and source_id and key == "mesoscale":
            raw = assessment_file(local, source_id, "source")
        elif isinstance(upload, UploadFile) and upload.size is not None and upload.size <= 64 * MIB:
            raw = await upload.read()
        else:
            raise CalculationError("请选择不超过64 MB的中尺度TXT。")
        try:
            density = float(str(form.get("density", "")))
            factor = float(str(form.get("factor", "75")))
        except ValueError as exc:
            raise CalculationError("请填写有效的空气密度和综合修正系数。") from exc
        if not 0 < density < 3 or not 0 < factor <= 100:
            raise CalculationError("空气密度须在0至3之间，综合修正系数须大于0且不超过100%。")
        year_text = str(form.get("analysis_year", "")).strip()
        try:
            analysis_year = int(year_text) if year_text else None
        except ValueError as exc:
            raise CalculationError("分析年须为自然年年份。") from exc
        try:
            heights = AssessmentHeights.model_validate(
                {key: form.get(key) or None for key in AssessmentHeights.model_fields}
            )
        except ValidationError as exc:
            raise CalculationError("请检查轮毂高度、分析期平均气温和风切变指数。") from exc
        energy = form.get("energy")
        if energy is not None and (
            not isinstance(energy, UploadFile) or energy.size is None or energy.size > 4 * MIB
        ):
            raise CalculationError("发电量表不得超过4 MB。")
        energy_id = form.get("energy_id")
        if isinstance(energy_id, str) and energy_id and key == "mesoscale":
            energy_bytes = assessment_file(local, energy_id, "energy")
        else:
            energy_bytes = await energy.read() if energy else None
        location = {}
        for field, label, lo, hi in (
            ("lat", "纬度", -90, 90),
            ("lon", "经度", -180, 180),
            ("alt", "海拔高度", -500, 9000),
        ):
            value = str(form.get(field, "")).strip()
            if value:
                try:
                    if not lo <= float(value) <= hi:
                        raise ValueError()
                except ValueError as exc:
                    raise CalculationError(f"{label}超出有效范围。") from exc
                location[label] = value
        try:
            extreme = ExtremeOptions.model_validate_json(str(form.get("extreme", "{}")))
        except ValidationError as exc:
            raise CalculationError("请检查风速倍数、风压和五日雷暴法选项。") from exc
        run_id = form.get("run_id")
        if isinstance(run_id, str) and run_id and key == "mesoscale":
            saved = local.get("assessment-runs", run_id)
            if saved.get("calculation_version") != mesoscale_report.ASSESSMENT_CALCULATION_VERSION:
                raise CalculationError("该成果由旧版计算生成，请重新分析后导出。")
            if not isinstance(source_id, str) or not source_id:
                raise CalculationError("请使用本次分析保存的中尺度资料导出。")
            current = AssessmentOptions(
                source_id=source_id,
                density=density,
                analysis_year=analysis_year,
                extreme=extreme,
                **heights.model_dump(),
            )
            if saved.get("calculation_options") != current.model_dump():
                raise CalculationError("分析配置与当前结果不一致，请重新分析后导出。")
        result = await run_in_threadpool(
            render,
            data,
            raw,
            density,
            str(form.get("project", "")).strip()[:120],
            factor,
            energy_bytes,
            location,
            analysis_year=analysis_year,
            weibull_method=str(form.get("weibull_method", "mle")),
            hub_height_m=heights.hub_height_m,
            mean_temperature_c=heights.mean_temperature_c,
            wind_shear_exponent=heights.wind_shear_exponent,
            **extreme.calculation_options(local, for_export=True),
        )
    return Response(
        result,
        media_type=DOCX,
        headers={
            "Content-Disposition": 'attachment; filename="mesoscale-report.docx"',
            "X-Report-Template": f"{key}/{version}",
        },
    )
