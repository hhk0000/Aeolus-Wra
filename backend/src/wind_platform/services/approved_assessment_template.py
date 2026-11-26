"""Rebind the editable Shanghai example without changing the approved Word file."""

import re
from io import BytesIO

from docx.oxml.ns import qn
from docx.shared import Pt
from PIL import Image, ImageOps

from wind_platform.core.calculations import CalculationError

SAMPLE_FIELDS = {
    **dict.fromkeys((131, 135, 181, 182, 183, 184), "项目名称／XXX地区"),
    **dict.fromkeys((138, 140), "项目名称"),
    155: "海拔高度",
    156: "经度",
    157: "纬度",
    159: "参数k",
    160: "参数A",
    177: "容量系数",
    178: "年装机满发利用小时",
    179: "年上网电量",
    180: "不确定因素影响范围",
}


def is_green(run):
    props = run.find(qn("w:rPr"))
    if props is None:
        return False
    color = props.find(qn("w:color"))
    highlight = props.find(qn("w:highlight"))
    return (
        color is not None
        and color.get(qn("w:val")) in {"008000", "00B050"}
        and (highlight is None or highlight.get(qn("w:val")) == "none")
        and props.find(qn("w:shd")) is None
    )


def restore_chart_anchors(doc, titles, *, sample_title=None):
    for paragraph in doc.paragraphs:
        for shape in paragraph._p.xpath(".//w:pict/*[local-name()='shape']"):
            title = shape.get("id")
            if title not in titles:
                continue
            style = shape.get("style", "")
            width = re.search(r"(?:^|;)width:([\d.]+)pt", style)
            height = re.search(r"(?:^|;)height:([\d.]+)pt", style)
            images = shape.xpath("./*[local-name()='imagedata']")
            if not width or not height or len(images) != 1:
                raise CalculationError(f"评估模板图位无效：{title}")
            rid = images[0].get(qn("r:id"))
            image = BytesIO(doc.part.related_parts[rid].blob)
            if title == sample_title:
                with Image.open(image) as raw:
                    sample = ImageOps.expand(
                        raw.convert("RGB"), border=max(6, round(raw.width * 0.008)), fill="#FFEA65"
                    )
                image = BytesIO()
                sample.save(image, format="PNG")
                image.seek(0)
            picture = paragraph.add_run().add_picture(
                image,
                width=Pt(float(width[1])),
                height=Pt(float(height[1])),
            )
            picture._inline.docPr.name = title
            old = shape.getparent()
            old.getparent().remove(old)


def restore_sample_fields(paragraphs, fields):
    prefix = "AeolusReviewField_"
    for paragraph in paragraphs:
        for bookmark in paragraph._p.xpath("./w:bookmarkStart"):
            name = bookmark.get(qn("w:name"), "")
            if not name.startswith(prefix):
                continue
            field = SAMPLE_FIELDS.get(int(name.removeprefix(prefix)))
            if field not in fields:
                continue
            start = paragraph._p.index(bookmark)
            end = next(
                element
                for element in paragraph._p[start + 1 :]
                if element.tag == qn("w:bookmarkEnd")
                and element.get(qn("w:id")) == bookmark.get(qn("w:id"))
            )
            text_nodes = [
                node
                for element in paragraph._p[start + 1 : paragraph._p.index(end)]
                for node in element.iter(qn("w:t"))
            ]
            if text_nodes and all(is_green(node.getparent()) for node in text_nodes):
                text_nodes[0].text = f"【{field}】"
                for node in text_nodes[1:]:
                    node.text = ""


def select_thunderstorm_section(doc, enabled):
    children = list(doc.element.body)
    texts = ["".join(node.text or "" for node in child.iter(qn("w:t"))) for child in children]
    start = next(i for i, text in enumerate(texts) if text.startswith("（3）五日雷暴法"))
    end = next(i for i in range(start + 1, len(texts)) if "【实际参与比选的方法】" in texts[i])
    if not enabled:
        for child in children[start:end]:
            doc.element.body.remove(child)
