"""Read tabular values from the first worksheet of a small turbine XLSX."""

import csv
import posixpath
import re
from io import BytesIO, StringIO
from zipfile import BadZipFile, ZipFile

from lxml import etree

from wind_platform.core.calculations import CalculationError


def workbook_csv(raw):
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

    def xml(z, path):
        return etree.fromstring(
            z.read(path), parser=etree.XMLParser(resolve_entities=False, no_network=True)
        )

    try:
        with ZipFile(BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist()) > 32 * 1024**2:
                raise ValueError()
            sheet = next(xml(z, "xl/workbook.xml").iter(ns + "sheet"))
            rid = sheet.get(rel + "id")
            target = next(
                e.get("Target") for e in xml(z, "xl/_rels/workbook.xml.rels") if e.get("Id") == rid
            )
            path = posixpath.normpath(posixpath.join("xl", target)).lstrip("/")
            shared = []
            if "xl/sharedStrings.xml" in z.namelist():
                shared = [
                    "".join(t.text or "" for t in s.iter(ns + "t"))
                    for s in xml(z, "xl/sharedStrings.xml").iter(ns + "si")
                ]
            buffer = StringIO()
            writer = csv.writer(buffer)
            for row in xml(z, path).iter(ns + "row"):
                values = {}
                for cell in row.findall(ns + "c"):
                    ref = re.fullmatch(r"([A-Z]{1,3})\d+", cell.get("r", ""))
                    if not ref:
                        raise ValueError()
                    col = 0
                    for letter in ref[1]:
                        col = col * 26 + ord(letter) - 64
                    if col > 64:
                        raise ValueError()
                    value = cell.findtext(ns + "v", "")
                    if cell.get("t") == "s":
                        value = shared[int(value)]
                    if cell.get("t") == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(ns + "t"))
                    values[col] = value
                if any(values.values()):
                    writer.writerow([values.get(i, "") for i in range(1, max(values) + 1)])
            return buffer.getvalue()
    except (
        BadZipFile,
        KeyError,
        StopIteration,
        IndexError,
        ValueError,
        etree.XMLSyntaxError,
    ) as exc:
        raise CalculationError("无法读取机组发电量工作簿，请检查第一张表的表头和数值。") from exc
