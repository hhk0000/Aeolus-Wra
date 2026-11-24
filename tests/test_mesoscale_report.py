from io import BytesIO
from zipfile import ZipFile

from docx import Document
from fastapi.testclient import TestClient
from wind_platform.main import create_app


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
