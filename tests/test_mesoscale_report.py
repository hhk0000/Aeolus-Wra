from io import BytesIO
from zipfile import ZipFile

import pytest
from docx import Document
from fastapi.testclient import TestClient
from PIL import Image
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
        rows.append(f"{y}/12/31 22:00	4	0")
        rows.append(f"{y}/12/31 23:00	6	90")
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
    roses = {
        shape._inline.docPr.name: shape
        for shape in doc.inline_shapes
        if "玫瑰图" in shape._inline.docPr.name
    }
    assert set(roses) == {"风向频率玫瑰图", "风能频率玫瑰图", "20年风向频率玫瑰图"}
    for shape in roses.values():
        drawing = shape._inline.graphic.graphicData.pic
        assert drawing.xpath("./pic:spPr/a:ln")
        image_part = doc.part.related_parts[drawing.blipFill.blip.embed]
        with Image.open(BytesIO(image_part.blob)) as image:
            assert shape.height == round(shape.width * image.height / image.width)
        assert drawing.spPr.xfrm.ext.cy == shape.height
    saved = client.post(
        "/api/v1/reports/assessment/files/source",
        files={"file": ("greenwich.txt", "\n".join(rows).encode())},
    )
    assert saved.status_code == 200
    data = saved.json()
    assert (data["start_year"], data["end_year"], data["year"], data["height"]) == (
        2003,
        2022,
        2003,
        125,
    )
    assert data["coordinates"] == {}
    run = client.post(
        "/api/v1/reports/assessment/runs",
        json={"source_id": data["id"], "density": 1.2},
    )
    assert run.status_code == 200
    output = client.get("/api/v1/reports/assessment/runs/" + run.json()["id"]).json()
    assert output["year"] == data["year"]
    assert [len(table["rows"]) for table in output["tables"].values()] == [13, 24, 27, 16, 16]
    for index, table in enumerate(output["tables"].values(), 1):
        assert table["rows"] == [
            [cell.text for cell in row.cells] for row in doc.tables[index].rows[1:]
        ]
    assert len(output["charts"]) == 6
    archive_export = client.post(path + "/export", data={"source_id": data["id"], "density": "1.2"})
    assert archive_export.status_code == 200

    assert (
        client.post(
            path + "/export",
            files={"data": ("short.txt", rows[0] + "\n" + rows[-1])},
            data={"density": "1.2"},
        ).status_code
        == 422
    )


def test_selected_natural_year_is_shared_by_results_and_word(tmp_path):
    client = TestClient(create_app(tmp_path))
    rows = ["Date & Time Stamp\tCH1Anem125m m/s\tCH2Vane125m Deg"]
    for year in range(2003, 2023):
        speed = 8 if year == 2004 else 5
        rows.extend(f"{year}/{month:02}/01 00:00\t{speed}\t0" for month in range(1, 13))
        rows.append(f"{year}/12/31 23:00\t{speed}\t90")
    source = client.post(
        "/api/v1/reports/assessment/files/source",
        files={"file": ("greenwich.txt", "\n".join(rows).encode())},
    ).json()
    assert source["year"] == 2003
    options = {"source_id": source["id"], "density": 1.2, "analysis_year": 2004}
    run_url = "/api/v1/reports/assessment/runs"
    run = client.post(run_url, json=options)
    assert run.status_code == 200
    result = client.get(run_url + "/" + run.json()["id"]).json()
    assert result["year"] == 2004
    assert result["tables"]["风速和风功率密度月变化图"]["rows"][0][1] == "8.00"
    export_url = "/api/v1/reports/templates/mesoscale/1.0.0/export"
    word = client.post(export_url, data=options)
    assert word.status_code == 200
    report = Document(BytesIO(word.content))
    assert report.tables[1].rows[1].cells[1].text == "8.00"
    assert "手动选择分析年，系统推荐年份为2003年" in "".join(p.text for p in report.paragraphs)
    options["analysis_year"] = 2023
    assert client.post(run_url, json=options).status_code == 422
    assert client.post(export_url, data=options).status_code == 422


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
