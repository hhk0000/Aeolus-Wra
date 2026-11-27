"""Trusted, immutable report releases shipped with the application."""

import hashlib
import json
from functools import partial
from pathlib import Path

from wind_platform.core.calculations import CalculationError
from wind_platform.services import mesoscale_report

ROOT = Path(__file__).resolve().parents[1] / "report_templates"
RENDERERS = {
    "mesoscale-v1": mesoscale_report.build,
    "mesoscale-formal": partial(mesoscale_report.build, formal_layout=True),
    "mesoscale-approved": partial(mesoscale_report.build, formal_layout=True, approved_layout=True),
    "mesoscale-reviewed": partial(
        mesoscale_report.build, formal_layout=True, approved_layout=True, reviewed_layout=True
    ),
    "mesoscale-figure-review": partial(
        mesoscale_report.build,
        formal_layout=True,
        approved_layout=True,
        reviewed_layout=True,
        figure_review_layout=True,
    ),
}


def catalog():
    return json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))


def release(key, version):
    item = catalog().get(key)
    if not item or version not in item["releases"]:
        raise CalculationError("找不到指定版本的报告模板。")
    settings = item["releases"][version]
    data = (ROOT / key / (version + ".docx")).read_bytes()
    if hashlib.sha256(data).hexdigest() != settings["sha256"]:
        raise CalculationError("模板版本校验失败，请恢复已发布的模板文件。")
    return data, RENDERERS[settings["renderer"]]
