"""Fill the native turbine table from the supplied project data."""

import csv
import math
from copy import deepcopy
from io import StringIO

from wind_platform.core.calculations import CalculationError
from wind_platform.services.energy_workbook import workbook_csv


def energy_table(table, raw, factor, fill):
    prototype = deepcopy(table.rows[1]._tr)
    total = table.rows[-1]._tr
    for row in list(table.rows)[1:-1]:
        table._tbl.remove(row._tr)
    rows = []
    if raw and raw.startswith(b"PK"):
        raw = workbook_csv(raw).encode("utf-8")
    if raw:
        try:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("gb18030")
            reader = csv.DictReader(
                StringIO(text), delimiter="\t" if "\t" in text.splitlines()[0] else ","
            )
            required = {"序号", "尾流后理论年发电量(MWh)", "单机容量(MW)"}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError()
            ids = set()
            for r in reader:
                name = r["序号"].strip()
                energy = float(r["尾流后理论年发电量(MWh)"])
                capacity = float(r["单机容量(MW)"])
                if (
                    not name
                    or name in ids
                    or not math.isfinite(energy)
                    or energy < 0
                    or not math.isfinite(capacity)
                    or capacity <= 0
                    or len(rows) >= 1000
                ):
                    raise ValueError()
                ids.add(name)
                rows.append((r, energy, capacity))
            if not rows:
                raise ValueError()
        except (ValueError, KeyError, TypeError, IndexError, AttributeError, csv.Error) as exc:
            raise CalculationError(
                "发电量表需要CSV/制表符文本，含唯一序号、尾流后理论年发电量(MWh)、单机容量(MW)，能量非负、容量为正。"
            ) from exc
    for i, (r, base, mw) in enumerate(rows):
        total.addprevious(deepcopy(prototype))
        net = base * factor / 100
        values = [
            r["序号"],
            *[r.get(k, "—") for k in ("X", "Y", "Z", "机型", "H", "平均风速", "尾流后平均风速")],
            f"{base:.2f}",
            f"{net:.2f}",
            f"{net / mw:.1f}",
            r.get("尾流折减(%)", "—"),
            r.get("备注", ""),
        ]
        for cell, value in zip(table.rows[i + 1].cells, values, strict=True):
            fill(cell, value)
    total_cells = table.rows[-1].cells
    for cell in total_cells:
        fill(cell, "—")
    fill(total_cells[0], "平均值" if rows else "待上传各风机发电量估算表")
    if not rows:
        return {}
    base = sum(r[1] for r in rows)
    net = base * factor / 100
    mw = sum(r[2] for r in rows)
    for i, value in [(8, base / len(rows)), (9, net / len(rows)), (10, net / mw)]:
        fill(total_cells[i], f"{value:.2f}")
    return {
        "理论电量合计": f"{base:.2f}",
        "单机理论电量均值": f"{base / len(rows):.2f}",
        "年上网电量": f"{net / 10:.2f}",
        "年装机满发利用小时": f"{net / mw:.1f}",
        "容量系数": f"{net / mw / 8760:.3f}",
    }
