"""Explicit text-to-channel mapping; recognition suggestions never silently import values."""

import csv
import json
import math
import re
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, model_validator

from wind_platform.core.calculations import CalculationError

RULES = json.loads(Path(__file__).with_name("channel_rules.json").read_text(encoding="utf-8"))
QUANTITIES = {
    "wind_speed": "speed",
    "wind_direction": "direction",
    "air_temperature": "temperature",
    "air_pressure": "pressure",
    "humidity": "humidity",
    "voltage": "voltage",
}
STATISTICS = {"mean": "mean", "standard_deviation": "sd", "maximum": "max", "minimum": "min"}
UNITS = {
    "speed": {"m/s": (1, 0)},
    "direction": {"deg": (1, 0)},
    "temperature": {"C": (1, 0), "K": (1, -273.15)},
    "pressure": {"Pa": (1, 0), "hPa": (100, 0), "kPa": (1000, 0), "mb": (100, 0)},
    "humidity": {"%": (1, 0)},
    "voltage": {"V": (1, 0)},
}


class ChannelMapping(BaseModel):
    index: int = Field(ge=0)
    quantity: str
    statistic: str = "mean"
    height: float = Field(ge=0)
    unit: str
    arm: str = ""

    @model_validator(mode="after")
    def wind_height_must_be_positive(self):
        if self.quantity in {"speed", "direction"} and self.height == 0:
            raise ValueError("风速和风向通道的安装高度必须大于0m。")
        return self


class ParseOptions(BaseModel):
    header_line: int = Field(ge=1, default=1)
    data_line: int = Field(ge=2, default=2)
    delimiter: str = "tab"
    timestamp_column: int = Field(ge=0, default=0)
    time_column: int | None = Field(ge=0, default=None)
    timestamp_format: str = "auto"
    timezone: str
    interval_minutes: int = Field(ge=1, le=1440, default=10)
    timestamp_position: str = "start"
    missing_values: list[str] = Field(default_factory=lambda: ["", "NaN", "nan", "-9999", "-999"])
    channels: list[ChannelMapping] = Field(min_length=1, max_length=200)


def _decode_standard(content: bytes) -> tuple[str, str]:
    for encoding in ["utf-8-sig", "gb18030"]:
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise CalculationError("文件既不是UTF-8也不是GB18030，请先转换文本编码。")


def decode_text(content: bytes) -> tuple[str, str]:
    if b"\x00" in content:
        raise CalculationError("文件包含二进制零字节，请使用TXT/CSV文本。")
    try:
        return content.decode("utf-8-sig"), "utf-8-sig"
    except UnicodeDecodeError:
        pass
    # Some Windographer exports mix a Windows single-byte degree symbol with
    # UTF-8 Celsius units. GB18030 alone accepts 0xB0 followed by ']'/'C' as a
    # Chinese character, silently corrupting the displayed unit. Restore ONLY
    # the exact known bracketed units, and only in a signed export header.
    head = content[:65536]
    header = re.search(rb"(?m)^Date/Time\t[^\r\n]*", head)
    signature = re.search(rb"(?m)^Created [^\r\n]+ by Windographer [0-9.]+\r?$", head)
    legacy_units = {b"[\xb0]": "[°]", b"[\xb0C]": "[°C]"}
    if signature and header and any(unit in header[0] for unit in legacy_units):
        parts = re.split(rb"(\[[^\]]*\])", header[0])
        decoded_header = "".join(
            legacy_units[part] if part in legacy_units else _decode_standard(part)[0]
            for part in parts
        )
        prefix = _decode_standard(content[: header.start()])[0]
        suffix = _decode_standard(content[header.end() :])[0]
        return prefix + decoded_header + suffix, "Windographer mixed units (UTF-8/GB18030)"
    return _decode_standard(content)


def split_line(line: str, delimiter: str) -> list[str]:
    if delimiter == "space":
        return re.split(r"\s+", line.strip())
    sep = {"tab": "\t", "comma": ",", "semicolon": ";"}.get(delimiter)
    if sep is None:
        raise CalculationError("不支持的分隔符。")
    return next(csv.reader([line], delimiter=sep))


def split_headers(line: str, delimiter: str) -> tuple[list[str], int]:
    headers = split_line(line, delimiter)
    original_count = len(headers)
    while headers and not headers[-1].strip():
        headers.pop()
    if not headers:
        raise CalculationError("表头没有命名列，请核对表头行号。")
    return headers, original_count - len(headers)


def normalize_record(cells: list[str], named_columns: int, trailing_header_blanks: int):
    # Only an exporter-added EMPTY header tail can authorize discarding matching
    # EMPTY record tails. Missing named columns and extra values remain errors.
    surplus = len(cells) - named_columns
    if 0 < surplus <= trailing_header_blanks and all(not v.strip() for v in cells[named_columns:]):
        return cells[:named_columns]
    return cells


def matches(header: str, keyword: str) -> bool:
    # Short Latin tokens must be delimited: 'v' must not match Avg or Valid.
    # Splitting letter/number boundaries supports WS100, but SW never matches WS.
    if re.fullmatch(r"[A-Za-z]{1,3}", keyword):
        return bool(
            re.search(r"(?<![A-Za-z])" + re.escape(keyword) + r"(?![A-Za-z])", header, re.I)
        )
    return keyword.casefold() in header.casefold()


def suggest_channel(header: str, rules=None) -> dict:
    rules = RULES["rules"] if rules is None else rules
    hits = [
        rule["id"]
        for rule in rules
        if any(matches(header, word) for word in rule["keywords"])
        and not any(matches(header, word) for word in rule["exclude_keywords"])
    ]
    quantities = [QUANTITIES[key] for key in hits if key in QUANTITIES]
    statistics = [STATISTICS[key] for key in hits if key in STATISTICS]
    quantity = quantities[0] if len(quantities) == 1 else ""
    # Explicit gust exclusion also applies to the implicit mean fallback.
    statistic = statistics[0] if len(statistics) == 1 else "" if statistics else "mean"
    if re.search("gust", header, re.I) and statistic == "mean":
        statistic = ""
    if re.search("gust", header, re.I):
        quantity = ""
    height = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*m(?![/A-Za-z])", header, re.I)
    unit = {
        "speed": "m/s",
        "direction": "deg",
        "temperature": "C",
        "humidity": "%",
        "voltage": "V",
    }.get(quantity, "")
    if quantity == "pressure":
        unit = (
            "hPa"
            if re.search(r"hpa|\bmb\b", header, re.I)
            else "kPa"
            if re.search("kpa", header, re.I)
            else "Pa"
            if re.search(r"\bpa\b", header, re.I)
            else ""
        )
    if quantity == "temperature" and re.search(r"\bK\b", header):
        unit = "K"
    arm = re.search(
        r"\d+(?:\.\d+)?\s*m[_\s]+(NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|SE|SW|NW|N|E|S|W)(?=[_\s]|$)",
        header,
        re.I,
    )
    return {
        "quantity": quantity,
        "statistic": statistic,
        "height": float(height[1]) if height else None,
        "unit": unit,
        "arm": arm[1].upper() if arm else "",
        "ambiguous": len(quantities) != 1 or len(statistics) > 1,
        "note": "建议待确认；未识别高度/单位须手工填写。",
    }


_STAMP_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
)


def _read_stamp(token: str) -> datetime:
    """Parse one timestamp label without guessing month/day order."""
    cleaned = token.strip().replace("/", "-")
    try:
        return datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in _STAMP_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    raise ValueError(f"unrecognized timestamp: {token!r}")


def _timestamp_columns(headers: list[str]) -> tuple[int, int | None]:
    """Pick the date/timestamp column, and a separate time-of-day column if present."""
    strong = [
        index
        for index, header in enumerate(headers)
        if re.search(r"date|日期|时间戳|timestamp|datetime", header, re.I)
    ]
    weak = [
        index
        for index, header in enumerate(headers)
        if index not in strong and re.fullmatch(r"time|时间|时刻|hh:?mm", header.strip(), re.I)
    ]
    timestamp_column = strong[0] if strong else weak[0] if weak else 0
    time_column = next(
        (
            index
            for index, header in enumerate(headers)
            if index != timestamp_column and re.fullmatch(r"time|时间|时刻", header.strip(), re.I)
        ),
        None,
    )
    return timestamp_column, time_column


def _detect_timezone(stamps: list[datetime], preamble: str) -> tuple[str | None, list[str]]:
    """Infer a supported timezone only from explicit evidence; never silently assume."""
    aware = [stamp for stamp in stamps if stamp.utcoffset() is not None]
    if aware and len(aware) != len(stamps):
        return None, ["文件内时间戳部分带时区偏移、部分不带，导入时请明确时间基准。"]
    if aware:
        offsets = {stamp.utcoffset() for stamp in aware}
        if len(offsets) > 1:
            return None, ["文件内时间戳的UTC偏移不一致，请核对或先统一时间基准。"]
        offset = offsets.pop().total_seconds()
        known = {0: "UTC", 28800: "Etc/GMT-8"}
        if offset in known:
            return known[offset], []
        return None, [f"文件时间戳偏移为 UTC{offset / 3600:+g} 小时，首版仅支持UTC或固定UTC+8。"]
    declaration = re.search(
        r"(?:time\s*zone|时间基准|时区|tz)\s*[:=：]\s*(?:UTC|GMT)\s*([+-]\s*\d{1,2}(?::\d{2})?)?",
        preamble,
        re.I,
    )
    if declaration:
        hours = declaration.group(1)
        if hours is None:
            return "UTC", []
        label = hours.replace(" ", "")
        pieces = label[1:].split(":")
        minutes = int(pieces[1]) if len(pieces) > 1 else 0
        value = (int(pieces[0]) * 60 + minutes) * (-1 if label.startswith("-") else 1)
        if minutes >= 60:
            return None, [f"文件声明的时区 UTC{label} 分钟数无效，请核对时间基准。"]
        if value == 0:
            return "UTC", []
        if value == 480:
            return "Etc/GMT-8", []
        return None, [f"文件声明的时区偏移为 UTC{label}，首版仅支持UTC或固定UTC+8。"]
    if re.search(r"北京时间|中国标准时间", preamble):
        return "Etc/GMT-8", []
    return None, []


def _detect_position(preamble: str) -> str:
    if re.search(r"时间戳.*(?:终点|结束)|time\s*stamps?.*\bend\b", preamble, re.I):
        return "end"
    if re.search(r"时间戳.*(?:起点|开始)|time\s*stamps?.*\b(?:start|beginning)\b", preamble, re.I):
        return "start"
    return "start"


def preview(content: bytes, header_line: int | None = None, delimiter: str | None = None) -> dict:
    text, encoding = decode_text(content)
    lines = text.splitlines()
    if not lines:
        raise CalculationError("空文件。")
    if header_line is None:
        header_line = next(
            (
                i + 1
                for i, line in enumerate(lines[:200])
                if re.search(r"date|timestamp|日期|时间", line, re.I)
                and any(sep in line for sep in ["\t", ",", ";"])
            ),
            1,
        )
    if header_line > len(lines) or header_line < 1:
        raise CalculationError("表头行超出文件范围。")
    line = lines[header_line - 1]
    if delimiter is None:
        delimiter = max(
            ["tab", "comma", "semicolon"],
            key=lambda k: line.count({"tab": "\t", "comma": ",", "semicolon": ";"}[k]),
        )
        if not any(sep in line for sep in ["\t", ",", ";"]):
            delimiter = "space"
    headers, trailing_blanks = split_headers(line, delimiter)
    timestamp_column, time_column = _timestamp_columns(headers)
    stamps = []
    skipped = 0
    for row in lines[header_line : header_line + 300]:
        cells = split_line(row, delimiter)
        try:
            token = cells[timestamp_column].strip()
            if time_column is not None:
                token += " " + cells[time_column].strip()
            stamps.append(_read_stamp(token))
        except (IndexError, ValueError):
            skipped += 1

    def step_seconds(earlier: datetime, later: datetime) -> int | None:
        if (earlier.utcoffset() is None) != (later.utcoffset() is None):
            return None  # mixed offset awareness; reported separately
        return int((later - earlier).total_seconds())

    gaps = Counter(
        seconds
        for earlier, later in zip(stamps, stamps[1:], strict=False)
        if (seconds := step_seconds(earlier, later)) is not None and seconds > 0
    )
    gap_seconds = gaps.most_common(1)[0][0] if gaps else None
    interval = gap_seconds // 60 if gap_seconds and gap_seconds % 60 == 0 else None
    if interval is not None and not 1 <= interval <= 1440:
        interval = None
    warnings = []
    if not stamps:
        warnings.append("未识别到可用时间戳，请在导入设置中选择时间列或手动指定格式。")
    elif not gaps:
        warnings.append("时间戳可以解析，但没有识别出重复步长；请核对时间列或手动设置步长。")
    if skipped and stamps:
        warnings.append(f"前{len(stamps) + skipped}行中有{skipped}行时间戳未能解析，已跳过。")
    preamble = "\n".join(lines[: header_line - 1])
    timezone, timezone_warnings = _detect_timezone(stamps, preamble)
    warnings.extend(timezone_warnings)
    position = _detect_position(preamble)
    return {
        "detected": {
            "timestamp_column": timestamp_column,
            "time_column": time_column,
            "interval_minutes": interval,
            "timezone": timezone,
            "timestamp_position": position,
            "warnings": warnings,
        },
        "encoding": encoding,
        "header_line": header_line,
        "data_line": header_line + 1,
        "delimiter": delimiter,
        "line_count": len(lines),
        "headers": headers,
        "sample_rows": [
            normalize_record(split_line(line, delimiter), len(headers), trailing_blanks)
            for line in lines[header_line : header_line + 5]
        ],
        "suggestions": [dict(index=i, **suggest_channel(value)) for i, value in enumerate(headers)],
        "text_preview": "\n".join(lines[:35]),
    }


def parse_timestamp(text: str, timezone: str, format_: str) -> datetime:
    if timezone not in {"UTC", "Asia/Shanghai", "Etc/GMT-8"}:
        raise CalculationError("首版支持UTC、北京时间历史时区或固定UTC+8，请先转换其他时间基准。")
    if format_ != "auto":
        value = datetime.strptime(text, format_)
    else:
        try:
            value = datetime.fromisoformat(text.strip().replace("/", "-"))
        except ValueError as exc:
            raise CalculationError(
                "时间格式未识别；请填写Python strptime时间格式，不猜测月/日顺序。"
            ) from exc
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo(timezone))
    elif value.utcoffset() != value.astimezone(ZoneInfo(timezone)).utcoffset():
        raise CalculationError("文件时间戳的UTC偏移与所选时间基准不一致。")
    return value.astimezone(UTC)


def parse_dataset(content: bytes, options: ParseOptions) -> dict:
    text, encoding = decode_text(content)
    lines = text.splitlines()
    if options.data_line <= options.header_line or options.data_line > len(lines):
        raise CalculationError("数据起始行应晚于表头且在文件范围内。")
    if options.timestamp_position not in {"start", "end"}:
        raise CalculationError("时间戳位置须为start或end。")
    headers, trailing_blanks = split_headers(lines[options.header_line - 1], options.delimiter)
    indices = [c.index for c in options.channels]
    if (
        len(indices) != len(set(indices))
        or options.timestamp_column in indices
        or options.time_column in indices
    ):
        raise CalculationError("列映射重复，或时间列被用于数值通道。")
    required_indices = [options.timestamp_column, *indices]
    if options.time_column is not None:
        required_indices.append(options.time_column)
    if max(required_indices) >= len(headers):
        raise CalculationError("列号超出表头。")
    for channel in options.channels:
        if channel.quantity not in UNITS or channel.unit not in UNITS[channel.quantity]:
            raise CalculationError(f"不支持的要素/单位：{channel.quantity}/{channel.unit}。")
        if channel.statistic not in {"mean", "sd", "max", "min"}:
            raise CalculationError("统计类型未确认。")
    timestamps, values = [], [[] for _ in options.channels]
    missing = {x.casefold().strip() for x in options.missing_values}
    interval = timedelta(minutes=options.interval_minutes)
    previous = None
    for row_no, line in enumerate(lines[options.data_line - 1 :], options.data_line):
        if not line.strip():
            continue
        cells = normalize_record(split_line(line, options.delimiter), len(headers), trailing_blanks)
        if len(cells) != len(headers):
            raise CalculationError(
                f"第{row_no}行有{len(cells)}列，表头有{len(headers)}列；请核对分隔符和数据起始行。"
            )
        stamp_text = cells[options.timestamp_column].strip()
        if options.time_column is not None:
            stamp_text += " " + cells[options.time_column].strip()
        try:
            stamp = parse_timestamp(stamp_text, options.timezone, options.timestamp_format)
        except ValueError as exc:
            raise CalculationError(f"第{row_no}行时间错误：{exc}") from exc
        if options.timestamp_position == "end":
            stamp -= interval
        if (
            stamp.second
            or stamp.microsecond
            or stamp.minute % options.interval_minutes
            and options.interval_minutes <= 60
        ):
            raise CalculationError(f"第{row_no}行时间未对齐所选步长。")
        if previous is not None and (stamp <= previous or (stamp - previous) % interval):
            raise CalculationError(
                f"第{row_no}行时间重复、倒序或偏离步长网格；保留原文件，修正解析配置后重试。"
            )
        previous = stamp
        timestamps.append(stamp.isoformat())
        for column, channel in zip(values, options.channels, strict=True):
            token = cells[channel.index].strip()
            if token.casefold() in missing:
                column.append(None)
                continue
            try:
                value = float(token)
            except ValueError as exc:
                raise CalculationError(
                    f"第{row_no}行通道{headers[channel.index]}包含未声明的标记 {token[:40]!r}。"
                ) from exc
            if not math.isfinite(value):
                raise CalculationError(f"第{row_no}行出现非有限值，请声明缺测标记。")
            scale, offset = UNITS[channel.quantity][channel.unit]
            # Standard deviation in Kelvin and Celsius has the same scale, no offset.
            value = value * scale + (0 if channel.statistic == "sd" else offset)
            column.append(value)
    if not timestamps:
        raise CalculationError("未读到任何数据记录。")
    channels = [
        dict(channel.model_dump(), id=f"c{i}", name=headers[channel.index], values=column)
        for i, (channel, column) in enumerate(zip(options.channels, values, strict=True))
    ]
    return {
        "timestamps": timestamps,
        "channels": channels,
        "options": options.model_dump(),
        "encoding": encoding,
        "row_count": len(timestamps),
        "start": timestamps[0],
        "end_exclusive": (previous + interval).isoformat(),
    }


def dataset_summary(data: dict) -> dict:
    return {key: value for key, value in data.items() if key not in {"timestamps", "channels"}} | {
        "channels": [
            {key: value for key, value in c.items() if key != "values"}
            | {"valid_count": sum(v is not None for v in c["values"])}
            for c in data["channels"]
        ]
    }
