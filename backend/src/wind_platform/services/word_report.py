"""Assemble editable wind resource reports from saved runs and their chart views."""

from collections.abc import Sequence
from io import BytesIO
from struct import error as StructError
from typing import Annotated, BinaryIO
from zipfile import BadZipFile, ZipFile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.image.exceptions import InvalidImageStreamError, UnexpectedEndOfFileError
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.section import Section
from docx.shared import Cm, Emu, Pt, RGBColor
from lxml.etree import XMLSyntaxError
from PIL import Image
from pydantic import BaseModel, Field, model_validator

from wind_platform.core.calculations import CalculationError
from wind_platform.services.store import LocalStore

MARKER = "{{风资源分析}}"
MIB = 1024 * 1024
MAX_FIGURES = 256
SHORT = Annotated[str, Field(max_length=500)]
CELL = Annotated[str, Field(max_length=2000)]


class ReportFigure(BaseModel):
    index: int = Field(ge=0, lt=MAX_FIGURES)
    caption: SHORT = ""


class ReportTable(BaseModel):
    caption: SHORT = ""
    headers: list[SHORT] = Field(min_length=1, max_length=40)
    rows: list[Annotated[list[CELL], Field(max_length=40)]] = Field(max_length=80)

    @model_validator(mode="after")
    def check_dimensions(self):
        if any(len(row) != len(self.headers) for row in self.rows):
            raise ValueError("表格各行的列数须与表头一致。")
        return self


class ReportSection(BaseModel):
    run_id: str = Field(pattern=r"^[0-9a-f]{32,64}$")
    output_id: str = Field(min_length=1, max_length=120)
    title: SHORT = ""
    figures: list[ReportFigure] = Field(default_factory=list, max_length=MAX_FIGURES)
    tables: list[ReportTable] | None = Field(default=None, max_length=32)


class ReportManifest(BaseModel):
    title: SHORT = "风资源分析报告"
    figure_width_percent: int = Field(default=100, ge=25, le=100)
    sections: list[ReportSection] = Field(min_length=1, max_length=128)


def _open_document(template):
    if template is None:
        document = Document()
        section = document.sections[0]
        section.page_width, section.page_height = Cm(21), Cm(29.7)
        section.left_margin = section.right_margin = Cm(2.3)
        section.top_margin = section.bottom_margin = Cm(2.2)
        for style_name in ("Normal", "Title", "Heading 1", "Heading 2", "Caption"):
            style = document.styles[style_name]
            style.font.color.rgb = RGBColor.from_string("172F28")
            style.font.name = "Times New Roman"
            style.element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "宋体")
        title_style = document.styles["Title"]
        title_style.font.color.rgb = RGBColor.from_string("000000")
        for border in title_style.element.xpath("./w:pPr/w:pBdr"):
            border.getparent().remove(border)
        return document, None, section

    try:
        with ZipFile(template) as package:
            entries = package.infolist()
            if len(entries) > 16000 or sum(i.file_size for i in entries) > 384 * MIB:
                raise CalculationError("Word 模板解压后过大，请选用精简模板。")
        template.seek(0)
        document = Document(template)
        markers = [p for p in document.paragraphs if p.text.strip() == MARKER]
        if len(markers) != 1:
            raise CalculationError(f"模板正文需要一个独立段落 {MARKER}，已找到 {len(markers)} 个。")
        marker = markers[0]._p
        # Each section ends at its sectPr, including one on the marker paragraph itself.
        properties = marker.xpath("./w:pPr/w:sectPr | following::w:sectPr")
        sect = properties[0] if properties else document.element.body.get_or_add_sectPr()
        return document, marker, Section(sect, document.part)
    except CalculationError:
        raise
    except (
        BadZipFile,
        KeyError,
        ValueError,
        OSError,
        IndexError,
        XMLSyntaxError,
        AttributeError,
        RuntimeError,
    ) as exc:
        raise CalculationError("无法打开该 Word 模板，请使用有效的 .docx 文档。") from exc


def _page_area(section):
    width = (
        (section.page_width or Cm(21))
        - (section.left_margin or Cm(2.3))
        - (section.right_margin or Cm(2.3))
        - (section.gutter or 0)
    )
    height = (
        (section.page_height or Cm(29.7))
        - (section.top_margin or Cm(2.2))
        - (section.bottom_margin or Cm(2.2))
    )
    if width <= 0 or height <= 0:
        raise CalculationError("模板所在节的版心无效，请检查页宽与边距。")
    return width, height


def _paragraph(document, text, style):
    try:
        return document.add_paragraph(text, style=style)
    except KeyError:
        # A project template may omit optional built-in styles.
        return document.add_paragraph(text)


def _add_figure(document, stream, caption, width, height):
    try:
        with Image.open(stream, formats=["PNG"]) as image:
            px_w, px_h = image.size
            if px_w * px_h > 24_000_000:
                raise CalculationError("单张图表不得超过 2400 万像素。")
            image.verify()
        stream.seek(0)
        scale = min(width / px_w, height * 0.65 / px_h)
        paragraph = document.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.keep_with_next = True
        shape = paragraph.add_run().add_picture(
            stream, width=Emu(scale * px_w), height=Emu(scale * px_h)
        )
        shape._inline.docPr.set("descr", caption)
    except (
        OSError,
        SyntaxError,
        StructError,
        Image.DecompressionBombError,
        UnexpectedEndOfFileError,
        InvalidImageStreamError,
    ) as exc:
        raise CalculationError("图表文件不是有效的 PNG 图像。") from exc
    paragraph = _paragraph(document, caption, "Caption")
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = False


def _snapshot_table(output):
    """Bound the printed excerpt; the complete run remains available as CSV."""
    rows = output.get("rows", [])
    if not rows:
        return []
    keys = list(
        dict.fromkeys(
            key
            for row in rows[:24]
            for key, value in row.items()
            if not isinstance(value, (list, dict)) and key not in {"points", "through_origin"}
        )
    )
    if not keys:
        return []
    view = rows[:24]
    caption = (
        "计算结果" if len(view) == len(rows) else f"计算结果（共 {len(rows)} 行，列出前 24 行）"
    )

    def display(value):
        if value is None:
            return "—"
        if isinstance(value, bool):
            return "是" if value else "否"
        return f"{value:.6g}" if isinstance(value, float) else str(value)

    return [
        ReportTable(
            headers=keys, rows=[[display(r.get(k)) for k in keys] for r in view], caption=caption
        )
    ]


def _add_table(document, view, width):
    # Repeat the identifying first column when a wide table spans several blocks.
    others = list(range(1, len(view.headers)))
    groups = [[0, *others[i : i + 6]] for i in range(0, len(others), 6)] or [[0]]
    for index, columns in enumerate(groups):
        caption = view.caption or "计算结果"
        if len(groups) > 1:
            caption += f"（第 {index + 1}/{len(groups)} 组列）"
        _paragraph(document, caption, "Caption").paragraph_format.keep_with_next = True
        table = document.add_table(rows=0, cols=len(columns))
        table.autofit = False
        for column in table.columns:
            column.width = Emu(width / len(columns))
        for row_index, values in enumerate([view.headers, *view.rows]):
            row = table.add_row()
            row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
            if not row_index:
                row._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
            for cell, n in zip(row.cells, columns, strict=True):
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_after = Pt(3)
                paragraph.paragraph_format.space_before = Pt(3)
                run = paragraph.add_run(values[n])
                run.font.size = Pt(9)
                if not row_index:
                    run.bold = True
                if row_index % 2 == 0:
                    shade = OxmlElement("w:shd")
                    shade.set(qn("w:fill"), "D9E6DF" if not row_index else "F4F7F5")
                    cell._tc.get_or_add_tcPr().append(shade)


def build_report(
    store: LocalStore,
    manifest: ReportManifest,
    images: Sequence[BinaryIO],
    template: BinaryIO | None,
) -> bytes:
    figures = [f.index for section in manifest.sections for f in section.figures]
    if sorted(figures) != list(range(len(images))):
        raise CalculationError("清单中的图表编号与上传的 PNG 文件不匹配。")
    document, marker, layout = _open_document(template)
    width, height = _page_area(layout)
    body = document.element.body
    # All generated blocks are temporarily appended immediately before the final sectPr.
    existing = set(body)
    _paragraph(document, manifest.title, "Title" if marker is None else "Heading 1")
    runs = {}
    for section in manifest.sections:
        first_reference = section.run_id not in runs
        if first_reference:
            runs[section.run_id] = store.get("runs", section.run_id)
        run = runs[section.run_id]
        output = run.get("outputs", {}).get(section.output_id)
        if not output or output["status"] != "ready":
            raise CalculationError(f"运行中没有可导出的成果 {section.output_id}。")
        _paragraph(document, section.title or output["title"], "Heading 2")
        if first_reference:
            config = run.get("config", {})
            if tower := config.get("tower_name"):
                document.add_paragraph(f"测风塔　{tower}")
            if config.get("start") and config.get("end"):
                document.add_paragraph(
                    f"分析时段　{config['start']} 至 {config['end']}（不含终点）"
                )
            for warning in run.get("warnings", []):
                document.add_paragraph(f"数据说明　{warning}")
        method = run.get("methods", {}).get(output["method"], {}).get("title", output["method"])
        document.add_paragraph(f"计算方法　{method}　　运行编号　{section.run_id}")
        for figure in section.figures:
            _add_figure(
                document,
                images[figure.index],
                figure.caption or output["title"],
                width * manifest.figure_width_percent / 100,
                height,
            )
        tables = section.tables if section.tables is not None else _snapshot_table(output)
        for table in tables:
            _add_table(document, table, width)
    if marker is not None:
        for block in list(body):
            if block not in existing:
                marker.addprevious(block)
        if marker.xpath("./w:pPr/w:sectPr"):
            marker.clear_content()  # retain this section break
        else:
            body.remove(marker)
    result = BytesIO()
    document.save(result)
    return result.getvalue()
