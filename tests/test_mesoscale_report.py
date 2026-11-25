from io import BytesIO
from zipfile import ZipFile

import pytest
from docx import Document
from fastapi.testclient import TestClient
from wind_platform.core.calculations import CalculationError
from wind_platform.main import create_app
from wind_platform.services.mesoscale_report import hourly_records


def test_versioned_mesoscale_download_and_export(tmp_path):
    client = TestClient(create_app(tmp_path))
    entry = client.get("/api/v1/reports/templates").json()[0]
    path = f"/api/v1/reports/templates/{entry['id']}/{entry['version']}"
    source = client.get(path + "/source")
    with ZipFile(BytesIO(source.content)) as package:
        assert not any("comments" in name.lower() for name in package.namelist())
    rows = ["Date & Time Stamp\tCH1Anem125m m/s\tCH2Vane125m Deg"]
    for y in range(2003, 2023):
        for month in range(1, 13):
            rows.append(f"{y}/{month:02}/01 00:00\t4\t0")
            rows.append(f"{y}/{month:02}/01 01:00\t6\t90")
    rows.append("2023/03/01 00:00\t99\t0")
    energy = "序号,尾流后理论年发电量(MWh),单机容量(MW)\nF01,10000,5"
    result = client.post(
        path + "/export",
        files={"data": ("a.txt", "\n".join(rows).encode()), "energy": ("a.csv", energy.encode())},
        data={"density": "1.2", "project": "测试场址", "factor": "75"},
    )
    assert result.status_code == 200, result.text[:500] if result.status_code != 200 else ""
    doc = Document(BytesIO(result.content))
    text = "".join(p.text for p in doc.paragraphs)
    assert "测试场址" in text and "【分析高度】" not in text
    assert doc.tables[0].rows[-1].cells[1].text == "5.00"
    assert doc.tables[1].rows[-1].cells[2].text == "84.00"
    assert doc.tables[6].rows[1].cells[9].text == "7500.00"
    assert all(s.width == 5040000 for s in doc.inline_shapes)
    assert len(doc.inline_shapes) == 10
    assert (
        client.post(
            path + "/export",
            files={"data": ("short.txt", rows[0] + "\n" + rows[-1])},
            data={"density": "1.2"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    ("header", "data", "height"),
    [
        (
            b"Created 2026/11/13 00:15 by Windographer 4.0.2\r\n\r\n"
            b"Date/Time\tDirection_100m [\xb0]\tSpeed_100m [m/s]\t",
            b"2022-01-01 00:00\t231.304\t8.576",
            "100",
        ),
        (
            b"Date & Time Stamp\tCH1Anem125m m/s\tCH1SD\tCH1Max\tCH1Min\t"
            b"CH2Vane125m Deg\tCH2SD\tCH2Max\tCH2Min",
            b"2022/01/01 00:00\t8.576\t1\t12\t2\t231.304\t5\t250\t120",
            "125",
        ),
    ],
)
def test_hourly_report_recognizes_both_source_formats(header, data, height):
    detected_height, records = hourly_records(header + b"\n" + data)
    assert detected_height == height
    assert list(records.values()) == [(8.576, 231.304)]


def test_hourly_report_does_not_pair_different_heights():
    raw = b"Date/Time\tSpeed_100m [m/s]\tDirection_125m [Deg]\n2022-01-01 00:00\t4\t90"
    with pytest.raises(CalculationError, match="高度不同"):
        hourly_records(raw)
