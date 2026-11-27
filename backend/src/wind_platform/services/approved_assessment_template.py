"""Rebind the editable Shanghai example without changing the approved Word file."""

import re
from copy import deepcopy
from io import BytesIO

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Pt
from docx.text.run import Run
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


def format_report_picture(shape):
    shape.height = Emu(round(Cm(14) * shape.height / shape.width))
    shape.width = Cm(14)
    extent = shape._inline.find(qn("wp:effectExtent"))
    if extent is None:
        extent = OxmlElement("wp:effectExtent")
        wp_extent = shape._inline.find(qn("wp:extent"))
        if wp_extent is not None:
            wp_extent.addnext(extent)
        else:
            shape._inline.insert(0, extent)
    for side in ("l", "t", "r", "b"):
        extent.set(side, "9525")
    properties = shape._inline.graphic.graphicData.pic.spPr
    for existing in properties.xpath("./a:ln"):
        properties.remove(existing)
    line = OxmlElement("a:ln")
    line.set("w", "6350")
    fill = OxmlElement("a:solidFill")
    color = OxmlElement("a:srgbClr")
    color.set("val", "000000")
    fill.append(color)
    line.append(fill)
    properties.append(line)


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


def replace_wording(paragraph, old, new):
    nodes = list(paragraph.iter(qn("w:t")))
    text = "".join(node.text or "" for node in nodes)
    start = text.find(old)
    if start < 0:
        raise CalculationError(f"评估模板缺少文字锚点：{old}")
    end = start + len(old)
    offset = 0
    for node in nodes:
        value = node.text or ""
        next_offset = offset + len(value)
        if offset < end and next_offset > start:
            prefix = value[: max(0, start - offset)]
            suffix = value[max(0, end - offset) :]
            node.text = prefix + (new if offset <= start < next_offset else "") + suffix
        offset = next_offset


def remove_long_term_word_content(doc):
    for paragraph in doc.paragraphs:
        content = paragraph.text
        if (
            "按年平均风速相对20年平均风速" in content
            or "【20年统计起止年份】" in content
            or content.startswith("图1.3-2")
        ):
            paragraph._p.getparent().remove(paragraph._p)
        elif "近20年各年风速表" in content:
            replace_wording(paragraph._p, "近20年各年风速表", "资料期各年风速表")
    for shape in doc.inline_shapes:
        if shape._inline.docPr.name == "近20年平均风速图":
            rid = shape._inline.graphic.graphicData.pic.blipFill.blip.embed
            paragraph = shape._inline.xpath("ancestor::w:p[1]")[0]
            paragraph.getparent().remove(paragraph)
            if rid not in doc.element.xpath(".//@r:id | .//@r:embed | .//@r:link"):
                doc.part.drop_rel(rid)
            return
    raise CalculationError("评估模板缺少图位：近20年平均风速图")


def adjust_reviewed_year_wording(paragraph, direct, review_required, pending, is_flat):
    text = paragraph.text
    if direct:
        start = text.find("考虑到")
        end = text.find("选取【代表年份】年1—12月", start)
        if start < 0 or end < 0:
            raise CalculationError("评估模板缺少代表年选取段落锚点")
        wording = (
            "该年份距报告编制年份已满 5 年，代表年待人工复核。当前暂"
            if pending
            else "经人工确认，仍"
            if review_required
            else "因此"
        )
        replace_wording(paragraph._p, text[start:end], wording)
        return
    if not review_required:
        replace_wording(
            paragraph._p, "考虑到【偏差最小年份】年距本阶段较远，经比选，", "经人工比选，"
        )
    if not is_flat and "，符合本项目平风年判定条件" in paragraph.text:
        replace_wording(paragraph._p, "，符合本项目平风年判定条件", "")


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
            if rid not in doc.part.related_parts:
                raise CalculationError(f"评估模板图位缺少图片：{title}")
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


def restore_sample_fields(paragraphs, fields, *, reviewed_layout=False):
    prefix = "AeolusReviewField_"
    for paragraph in paragraphs:
        for bookmark in paragraph._p.xpath("./w:bookmarkStart"):
            name = bookmark.get(qn("w:name"), "")
            if not name.startswith(prefix):
                continue
            number = name.removeprefix(prefix)
            if not re.fullmatch(r"[0-9]+", number):
                raise CalculationError(f"评估模板书签编号无效：{name}")
            number = int(number)
            if reviewed_layout and number in (155, 156, 157):
                continue
            field = SAMPLE_FIELDS.get(number)
            if field not in fields:
                continue
            start = paragraph._p.index(bookmark)
            end = next(
                (
                    element
                    for element in paragraph._p[start + 1 :]
                    if element.tag == qn("w:bookmarkEnd")
                    and element.get(qn("w:id")) == bookmark.get(qn("w:id"))
                ),
                None,
            )
            if end is None:
                raise CalculationError(f"评估模板书签缺少结束位置：{name}")
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
    start = next((i for i, text in enumerate(texts) if text.startswith("（3）五日雷暴法")), None)
    if start is None:
        raise CalculationError("评估模板缺少章节：五日雷暴法")
    end = next(
        (
            i
            for i in range(start + 1, len(texts))
            if "【实际参与比选的方法】" in texts[i]
            or (texts[i].startswith("综合以上方法计算结果") and "【机组参考风速类别】" in texts[i])
        ),
        None,
    )
    if end is None:
        raise CalculationError("评估模板缺少字段：实际参与比选的方法")
    if not enabled:
        for child in children[start:end]:
            doc.element.body.remove(child)


def clear_generated_chart_note(caption):
    if caption is None or caption.tag != qn("w:p"):
        return
    nodes = list(caption.iter(qn("w:t")))
    joined = "".join(node.text or "" for node in nodes)
    note = re.search(r"[ \u3000]*【换图】[ \u3000]*$", joined)
    if note is None:
        return
    remaining = note.start()
    for node in nodes:
        value = node.text or ""
        node.text = value[:remaining]
        remaining = max(0, remaining - len(value))


def apply_typefaces(run):
    props = run.get_or_add_rPr()
    fonts = props.get_or_add_rFonts()
    fonts.attrib.clear()
    fonts.set(qn("w:eastAsia"), "宋体")
    for script in ("ascii", "hAnsi", "cs"):
        fonts.set(qn(f"w:{script}"), "Times New Roman")


def style_inserted_numbers(run, *, density_units=False):
    unit = r"(?: kg/m³)?" if density_units else ""
    parts = re.split(rf"([-−+]?[0-9]+(?:[.,][0-9]+)*{unit})", run.text)
    if len(parts) == 1:
        return
    prototype = deepcopy(run._r)
    current = run
    run.text = parts[0]
    for index, part in enumerate(parts[1:], 1):
        if part:
            following = Run(deepcopy(prototype), run._parent)
            following.text = part
            current._r.addnext(following._r)
            current = following
            if index % 2:
                apply_typefaces(current._r)
    if not parts[0]:
        run._r.getparent().remove(run._r)


def apply_formula_typefaces(body):
    for table in body.xpath("./w:tbl"):
        if not any(
            re.fullmatch(r"[（(]1-[1-8][）)]", "".join(p.xpath(".//w:t/text()")).strip())
            for p in table.xpath(".//w:p")
        ):
            continue
        for run in table.iter(qn("w:r")):
            if not any(node.text for node in run.iter(qn("w:t"))):
                continue
            apply_typefaces(run)


PRESSURE_HEIGHT_NOTE = "风压法沿用风压参考值的原高度基准。"
EXTREME_CONCLUSION = " m/s。按《风力发电场设计规范》（GB 51096—2015）表 3.2.12 的参考风速初判，"


def remove_pressure_height_note(paragraph):
    if not paragraph.text.endswith(PRESSURE_HEIGHT_NOTE):
        return
    remaining = len(PRESSURE_HEIGHT_NOTE)
    for run in reversed(paragraph.runs):
        if remaining == 0:
            break
        count = min(remaining, len(run.text))
        if count:
            run.text = run.text[:-count]
            remaining -= count


def revise_extreme_conclusion(paragraph, speed, wind_class, *, bind_class=False):
    runs = [run for run in paragraph.runs if run.text]
    green = next((run._r for run in runs if run.text == speed and is_green(run._r)), None)
    if green is None:
        raise CalculationError("评估模板缺少绿色字段：标准空气密度下最大风速")
    black = runs[0]._r
    screening = (
        f"场址风速对应 IEC {wind_class} 类及以上的机组。"
        if wind_class
        else "场址风速超过 I 类参考风速，应由设计者按 S 类确定参数。"
    )
    anchor = next(iter(paragraph._p.findall(qn("w:commentRangeEnd"))), None)
    runs_to_add = [
        (
            black,
            "综合以上方法计算结果，出于安全保守考虑，"
            "推荐风电场区范围内标准空气密度下的 50 年一遇最大风速取 ",
        ),
        (green, speed),
    ]
    if bind_class:
        runs_to_add.extend(
            [
                (black, EXTREME_CONCLUSION + "对应 "),
                (green, "【机组参考风速类别】"),
                (black, "。"),
            ]
        )
        if not wind_class:
            runs_to_add.append((black, "应由设计者确定 S 类参数。"))
    else:
        runs_to_add.append((black, EXTREME_CONCLUSION + screening))
    runs_to_add.append((black, "最终机型应结合轮毂高度处年平均风速和湍流强度，由厂家复核。"))
    for template, text in runs_to_add:
        new = Run(deepcopy(template), paragraph)
        new.text = text
        if anchor is None:
            paragraph._p.append(new._r)
        else:
            anchor.addprevious(new._r)
    for run in runs:
        paragraph._p.remove(run._r)


def validate_release(doc, *, reviewed_layout=False):
    titles = {
        "近20年平均风速图",
        "风速和风功率密度月变化图",
        "风速和风功率密度日变化图",
        "风速和风能频率图",
        "风向频率玫瑰图",
        "风能频率玫瑰图",
        "威布尔分布图",
    }
    restore_chart_anchors(doc, titles)
    missing = titles - {shape._inline.docPr.name for shape in doc.inline_shapes}
    if missing:
        raise CalculationError(f"评估模板缺少图位：{'、'.join(sorted(missing))}")
    fields = set(SAMPLE_FIELDS.values())
    restore_sample_fields(doc.paragraphs, fields, reviewed_layout=reviewed_layout)
    for section in doc.sections:
        restore_sample_fields(section.header.paragraphs, fields, reviewed_layout=reviewed_layout)
    select_thunderstorm_section(doc, enabled=True)
    summary = next((p for p in doc.paragraphs if "【实际参与比选的方法】" in p.text), None)
    if summary is not None:
        revise_extreme_conclusion(summary, "【标准空气密度下最大风速】", None)
    elif not any(
        p.text.startswith("综合以上方法计算结果")
        and {"【标准空气密度下最大风速】", "【机组参考风速类别】"}
        <= set(re.findall(r"【[^】]+】", p.text))
        for p in doc.paragraphs
    ):
        raise CalculationError("评估模板缺少极大风速结论段落")
    if reviewed_layout:
        body = "\n".join(p.text for p in doc.paragraphs)
        for field in (
            "20年统计起止年份",
            "10年统计起止年份",
            "偏差最小年份",
            "分析高度空气密度",
            "轮毂高度",
            "中尺度纬度",
            "中尺度经度",
            "中尺度点位海拔",
        ):
            if f"【{field}】" not in body:
                raise CalculationError(f"评估模板缺少字段：{field}")
    remove_long_term_word_content(doc)
