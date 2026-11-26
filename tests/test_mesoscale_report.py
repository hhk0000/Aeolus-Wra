from datetime import datetime, timedelta
from io import BytesIO
from json import dumps
from math import log, log1p, sqrt
from statistics import mean, stdev
from zipfile import ZipFile

import pytest
from docx import Document
from fastapi.testclient import TestClient
from PIL import Image
from wind_platform.core.calculations import CalculationError
from wind_platform.main import create_app
from wind_platform.services.assessment_power_grade import classify_power_density
from wind_platform.services.mesoscale_report import assessment_source, hourly_records
from wind_platform.services.pressure_location import match_pressure


@pytest.mark.parametrize(
    ("place", "level", "station", "pressure"),
    [
        ("河北省张家口市怀来县", "county", "怀来", 0.35),
        ("河北 · 张家口", "city", "张家口市", 0.55),
        ("河北省张家口市崇礼区", "city", "张家口市", 0.55),
        ("河北省", "province", "石家庄市", 0.35),
        ("重庆市奉节县", "county", "奉节", 0.35),
        ("吉林市", "city", "吉林市", 0.50),
        ("吉林省", "province", "长春市", 0.65),
    ],
)
def test_pressure_lookup_uses_supplied_station_table(place, level, station, pressure):
    result = match_pressure(place)
    assert (result["level"], result["name"], result["pressure"]) == (level, station, pressure)
    assert "elevation" not in result


def test_pressure_lookup_leaves_unknown_place_empty():
    assert match_pressure("未知县") is None
    assert match_pressure("未知省张家口市") is None


def test_versioned_mesoscale_download_and_export(tmp_path):
    client = TestClient(create_app(tmp_path))
    entry = client.get("/api/v1/reports/templates").json()[0]
    path = f"/api/v1/reports/templates/{entry['id']}/1.1.0"
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
    stations_url = "/api/v1/reports/assessment/files/pressure"
    stations = client.post(
        stations_url,
        files={
            "file": (
                "风压库.txt",
                "地点\t经度\t纬度\t风压\n繁峙县\t113.27\t39.19\t0.45".encode("gb18030"),
            )
        },
    )
    assert stations.status_code == 200
    library = stations.json()
    assert client.get(f"{stations_url}/{library['id']}").json()["stations"] == [
        {"name": "繁峙县", "lon": 113.27, "lat": 39.19, "pressure": 0.45}
    ]
    assert (
        client.post(
            stations_url, files={"file": ("无效.txt", "繁峙县,113.27,39.19,-0.45".encode())}
        ).status_code
        == 422
    )
    result = client.post(
        path + "/export",
        files={"data": ("a.txt", "\n".join(rows).encode()), "energy": ("a.csv", energy.encode())},
        data={"density": "1.2", "project": "测试场址", "factor": "75"},
    )
    assert result.status_code == 422 and "手填后再导出" in result.json()["detail"]
    result = client.post(
        path + "/export",
        files={"data": ("a.txt", "\n".join(rows).encode()), "energy": ("a.csv", energy.encode())},
        data={
            "density": "1.2",
            "project": "测试场址",
            "factor": "75",
            "extreme": dumps({"pressure_override": 0.45}),
        },
    )
    assert result.status_code == 200, result.text[:500] if result.status_code != 200 else ""
    doc = Document(BytesIO(result.content))
    text = "".join(p.text for p in doc.paragraphs)
    assert "测试场址" in text and "【分析高度】" not in text
    assert entry["version"] == "1.3.0"
    assert "五日雷暴法" not in text and "取风压法" in text
    assert "24.74 m/s" in text
    assert doc.tables[0].rows[-1].cells[1].text == "5.00"
    assert doc.tables[1].rows[-1].cells[2].text == "84.00"
    assert doc.tables[6].rows[1].cells[9].text == "7500.00"
    formal = client.post(
        f"/api/v1/reports/templates/{entry['id']}/{entry['version']}/export",
        files={"data": ("a.txt", "\n".join(rows).encode()), "energy": ("a.csv", energy.encode())},
        data={
            "density": "1.2",
            "project": "测试场址",
            "extreme": dumps({"pressure_override": 0.45}),
        },
    )
    assert formal.status_code == 200
    formal_doc = Document(BytesIO(formal.content))
    assert len(formal_doc.inline_shapes) == 8
    assert formal_doc.tables[3].rows[1].cells[0].text == "0"
    assert any(s._inline.docPr.name == "风电机组布置示意图" for s in formal_doc.inline_shapes)
    turbine_table = next(
        table for table in formal_doc.tables if table.rows[0].cells[0].text == "序号"
    )
    original = Document(
        BytesIO(
            client.get(f"/api/v1/reports/templates/{entry['id']}/{entry['version']}/source").content
        )
    )
    assert [[cell.text for cell in row.cells] for row in turbine_table.rows] == [
        [cell.text for cell in row.cells] for row in original.tables[14].rows
    ]
    assert [[cell.text for cell in row.cells] for row in formal_doc.tables[-1].rows] == [
        [cell.text for cell in row.cells] for row in original.tables[15].rows
    ]
    net_value = turbine_table.rows[1].cells[9].paragraphs[0].runs[0]
    assert net_value.text == "15328.8"
    assert str(net_value.font.highlight_color) == "YELLOW (7)"
    assert net_value.font.name == "Times New Roman"
    assert net_value._r.xpath("./w:rPr/w:rFonts/@w:eastAsia") == ["宋体"]
    direction_text = next(p for p in formal_doc.paragraphs if "主要风向为" in p.text)
    assert all(
        str(run.font.color.rgb) != "008000"
        for run in direction_text.runs
        if "主要风向为" in run.text
    )
    approved_text = "\n".join(p.text for p in formal_doc.paragraphs)
    assert "年上网电量为750.00万kWh" in approved_text
    assert "【北纬31.34813571°】" in approved_text
    assert "【上海农投横沙新洲绿电直连项目】" in approved_text
    assert "【换图】" not in approved_text
    grade_paragraph = next(p for p in formal_doc.paragraphs if "风功率密度等级为" in p.text)
    assert any(run.text.endswith("级") and run.bold is False for run in grade_paragraph.runs)
    assert "近20年平均风速为5.00" in approved_text
    for shape in formal_doc.inline_shapes:
        assert shape.width == 5040000
        picture = shape._inline.graphic.graphicData.pic
        assert picture.spPr.xpath("./a:ln")[0].get("w") == "6350"
        part = formal_doc.part.related_parts[picture.blipFill.blip.embed]
        with Image.open(BytesIO(part.blob)) as image:
            assert shape.width / shape.height == pytest.approx(image.width / image.height)
    assert all(s.width == 5040000 for s in doc.inline_shapes)
    assert len(doc.inline_shapes) == 11
    roses = {
        shape._inline.docPr.name: shape
        for shape in doc.inline_shapes
        if "玫瑰图" in shape._inline.docPr.name
    }
    assert set(roses) == {
        "风向频率玫瑰图",
        "风能频率玫瑰图",
        "20年风向频率玫瑰图",
        "各月风向频率玫瑰图",
        "各月风能频率玫瑰图",
    }
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
    assert output["extreme"]["adopted"] is None and output["extreme"]["multiplier"] == 5

    place = "河北省张家口市怀来县"
    lookup = client.get("/api/v1/reports/assessment/pressure-match", params={"place": place}).json()
    assert lookup["station"]["pressure"] == 0.35
    location_options = {"source_id": data["id"], "density": 1.2, "extreme": {"place": place}}
    location_run = client.post("/api/v1/reports/assessment/runs", json=location_options)
    location_result = client.get(
        "/api/v1/reports/assessment/runs/" + location_run.json()["id"]
    ).json()["extreme"]["station"]
    assert location_result["pressure"] == 0.35 and location_result["requested_place"] == place

    location_options["extreme"]["pressure_override"] = 0.60
    manual_run = client.post("/api/v1/reports/assessment/runs", json=location_options)
    manual = client.get("/api/v1/reports/assessment/runs/" + manual_run.json()["id"]).json()[
        "extreme"
    ]
    assert manual["station"]["matched_pressure"] == 0.35
    assert manual["station"]["manual"] and manual["adopted"] == pytest.approx((1600 * 0.60) ** 0.5)
    manual_word = client.post(
        path + "/export",
        data={**location_options, "extreme": dumps(location_options["extreme"])},
    )
    assert manual_word.status_code == 200
    manual_text = "\n".join(p.text for p in Document(BytesIO(manual_word.content)).paragraphs)
    assert "采用手动填写的风压" in manual_text
    assert "河北怀来站的 0.35 kN/m²" in manual_text
    assert "30.98 m/s" in manual_text
    assert [len(table["rows"]) for table in output["tables"].values()] == [13, 24, 27, 16, 16]
    for index, table in enumerate(output["tables"].values(), 1):
        assert table["rows"] == [
            [cell.text for cell in row.cells] for row in doc.tables[index].rows[1:]
        ]
    assert [chart["plot"] for chart in output["charts"]] == [
        "monthly",
        "hourly",
        "frequency",
        "rose",
        "rose",
        "weibull",
    ]
    monthly, hourly, frequency, direction, energy, fit = output["charts"]
    assert monthly["rows"][0] == {"period": 1, "mean_speed": 5.0, "power_density": 84.0}
    assert len(hourly["rows"]) == 24 and hourly["rows"][2]["mean_speed"] is None
    assert frequency["fields"] == ["frequency", "energy_frequency"]
    assert direction["rows"][0]["degrees"] == 0
    assert energy["energy"] is True
    assert fit["fit"]["k"] > 0
    alternatives = output["weibull_charts"]
    assert set(alternatives) == {"least-squares", "moments", "energy"}
    for alternate in alternatives.values():
        assert alternate["fit"]["positive_count"] == fit["fit"]["positive_count"]
        assert [row["frequency"] for row in alternate["rows"]] == [
            row["frequency"] for row in fit["rows"]
        ]
    assert alternatives["moments"]["fit"]["k"] != pytest.approx(fit["fit"]["k"])
    assert all("image" not in chart for chart in output["charts"])
    extreme = {
        "pressure_library_id": library["id"],
        "pressure_station_index": 0,
        "multiplier": 5.1,
    }
    options = {"source_id": data["id"], "density": 1.2, "extreme": extreme}
    selected_run = client.post("/api/v1/reports/assessment/runs", json=options)
    selected_result = client.get(
        "/api/v1/reports/assessment/runs/" + selected_run.json()["id"]
    ).json()["extreme"]
    assert selected_result["pressure_standard"] == pytest.approx(26.83281573)
    assert selected_result["pressure_site"] == pytest.approx(26.83281573 * (1.225 / 1.2) ** 0.5)
    assert selected_result["site_speed"] == 25.5
    assert selected_result["multiplier_standard"] == pytest.approx(25.5 * (1.2 / 1.225) ** 0.5)
    assert selected_result["adopted"] == pytest.approx(selected_result["pressure_standard"])
    options["extreme"] = {**extreme, "multiplier": 6}
    selected_run = client.post("/api/v1/reports/assessment/runs", json=options)
    selected_result = client.get(
        "/api/v1/reports/assessment/runs/" + selected_run.json()["id"]
    ).json()["extreme"]
    assert selected_result["adopted"] == selected_result["multiplier_standard"]
    archive_export = client.post(
        path + "/export",
        data={**options, "extreme": dumps(options["extreme"]), "weibull_method": "moments"},
    )
    assert archive_export.status_code == 200
    archive_doc = Document(BytesIO(archive_export.content))
    extracted = "\n".join(p.text for p in archive_doc.paragraphs)
    assert any(shape._inline.docPr.get("descr") == "矩估计" for shape in archive_doc.inline_shapes)
    assert "繁峙县" in extracted and "0.45 kN/m²" in extracted and "26.83 m/s" in extracted
    assert "等效参考风速为 27.11 m/s" in extracted
    assert "折算至标准空气密度后为 29.69 m/s" in extracted and "五日雷暴法" not in extracted
    registry = client.get("/api/v1/standards").json()
    transfer = next(m for m in registry["methods"] if m["id"] == "assessment-density-transfer")
    assert transfer["source"] == "GB51096" and "1.225" in transfer["formula"]

    assert (
        client.post(
            path + "/export",
            files={"data": ("short.txt", rows[0] + "\n" + rows[-1])},
            data={"density": "1.2", "extreme": dumps({"pressure_override": 0.45})},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("year_count", [1, 2])
def test_short_assessment_exports_only_the_actual_period(tmp_path, year_count):
    client = TestClient(create_app(tmp_path))
    start = 2022
    rows = ["Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\tAir Density [kg/m^3]"]
    rows.append("2021-12-31 23:00\t99\t90\t2.0")
    for year in range(start, start + year_count):
        speed = 4 + (year - start) * 4
        density = 1.1 if year == start else 1.3
        rows.extend(
            [
                f"{year}-01-01 00:00\t{speed}\t90\t{density}",
                f"{year}-06-01 12:00\t{speed + 1}\t0\t",
                f"{year}-12-31 23:00\t{speed + 2}\t180\t{density if year == start else ''}",
            ]
        )
    rows.append(f"{start + year_count}-01-01 00:00\t99\t0\t2.0")
    raw = "\n".join(rows).encode()
    upload = client.post(
        "/api/v1/reports/assessment/files/source", files={"file": ("short.txt", raw)}
    ).json()
    assert upload["window_years"] == year_count
    expected_mean = 5 + 2 * (year_count - 1)
    assert upload["end_year"] == start + year_count - 1 and upload["mean_speed"] == expected_mean
    assert upload["density_period"] == pytest.approx(1.1 if year_count == 1 else 3.5 / 3)
    local = client.app.state.wind_store
    older = {**upload, "coverage_error": "资料未达到20年。"}
    older.pop("window_years")
    legacy = local.put("assessment-files", older)
    refreshed = client.get("/api/v1/reports/assessment/files/source/" + legacy["id"]).json()
    assert refreshed["window_years"] == year_count and refreshed["coverage_error"] is None
    options = {"source_id": upload["id"], "density": upload["density_period"]}
    runs_url = "/api/v1/reports/assessment/runs"
    run = client.post(runs_url, json=options)
    assert run.status_code == 200
    snapshot = client.get(runs_url + "/" + run.json()["id"]).json()
    assert snapshot["window_years"] == year_count
    assert snapshot["interval_minutes"] == 60
    assert len(snapshot["monthly_roses"]["frequency"]) == 12
    assert not snapshot["monthly_roses"]["frequency"][1]
    assert snapshot["analysis_start_year"] == start
    assert snapshot["analysis_end_year"] == upload["end_year"]
    month = snapshot["tables"]["风速和风功率密度月变化图"]
    assert month["rows"][0][1] == f"{expected_mean - 1:.2f}"
    assert month["rows"][-1][1] == f"{expected_mean:.2f}"
    if year_count == 2:
        assert month["rows"][-1][0] == "分析期平均"
    report = client.post(
        "/api/v1/reports/templates/mesoscale/1.1.0/export",
        data={**options, "extreme": dumps({"pressure_override": 0.45})},
    )
    assert report.status_code == 200
    doc = Document(BytesIO(report.content))
    body = "\n".join(p.text for p in doc.paragraphs)
    assert f"共{year_count}个自然年" in body
    assert "长期代表性待补充资料后复核" in body and "近20年" not in body
    assert f"分析期为{start}年1月—{upload['end_year']}年12月" in body
    assert len(doc.tables[0].rows) == year_count + 2
    assert [c.text for c in doc.tables[0].rows[-1].cells] == [
        f"{year_count}年平均",
        f"{expected_mean:.2f}",
        "近10年平均",
        "资料不足",
    ]


def test_ten_minute_assessment_uses_native_samples_and_real_hours(tmp_path):
    client = TestClient(create_app(tmp_path))
    raw = (
        b"Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\n"
        b"2023-01-01 00:00\t4\t0\n"
        b"2023-01-01 00:10\t5\t90\n"
        b"2023-01-01 00:20\t6\t90\n"
        b"2023-12-31 23:50\t8.024\t180\n"
    )
    source = client.post(
        "/api/v1/reports/assessment/files/source", files={"file": ("10min.txt", raw)}
    ).json()
    assert source["interval_minutes"] == 10 and source["window_years"] == 1
    options = {"source_id": source["id"], "density": 1.2}
    path = "/api/v1/reports/assessment/runs"
    saved = client.post(path, json=options)
    assert saved.status_code == 200
    output = client.get(path + "/" + saved.json()["id"]).json()
    assert output["fields"]["时间步长"] == "10 min"
    assert output["fields"]["区间累计时数"] == "0.67"
    assert output["extreme"]["mean_speed"] == pytest.approx(5.756)
    assert output["extreme"]["mean_speed_used"] == 5.76
    assert output["extreme"]["site_speed"] == pytest.approx(28.8)
    fit = next(chart["fit"] for chart in output["charts"] if chart["plot"] == "weibull")
    assert fit["positive_count"] == 4
    jan = output["monthly_roses"]
    assert jan["frequency"][0][4]["frequency"] == pytest.approx(200 / 3)
    assert jan["energy_frequency"][0][4]["energy_frequency"] == pytest.approx(
        100 * (5**3 + 6**3) / (4**3 + 5**3 + 6**3)
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
    word = client.post(export_url, data={**options, "extreme": dumps({"pressure_override": 0.45})})
    assert word.status_code == 200
    report = Document(BytesIO(word.content))
    assert report.tables[1].rows[1].cells[1].text == "8.00"
    assert "手动选择分析年，系统推荐年份为2003年" in "".join(p.text for p in report.paragraphs)
    options["analysis_year"] = 2023
    assert client.post(run_url, json=options).status_code == 422
    assert (
        client.post(
            export_url, data={**options, "extreme": dumps({"pressure_override": 0.45})}
        ).status_code
        == 422
    )


def test_optional_five_day_thunderstorm_uses_ten_minute_observations(tmp_path):
    client = TestClient(create_app(tmp_path))
    path = "/api/v1/reports/assessment"
    hourly = (
        "Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\n"
        "2023-01-01 00:00\t4\t0\n2023-01-01 01:00\t6\t90\n2023-12-31 23:00\t5\t90\n"
    )
    source = client.post(path + "/files/source", files={"file": ("hourly.txt", hourly)}).json()
    options = {
        "source_id": source["id"],
        "density": 1.2,
        "extreme": {"pressure_override": 0.45, "thunderstorm": {"c1": 1.2, "c2": 0.55}},
    }
    rejected = client.post(path + "/runs", json=options)
    assert rejected.status_code == 422 and "另传" in rejected.json()["detail"]

    beginning = datetime(2023, 1, 1)
    step = timedelta(minutes=10)
    block_sizes = [17 + index % 12 for index in range(73)]
    measured = "\n".join(
        ["Date/Time\tSpeed_100m [m/s]"]
        + [
            f"{beginning + index * step:%Y-%m-%d %H:%M}\t{value}"
            for block, value in enumerate(block_sizes)
            for index in range(block * 720, (block + 1) * 720)
        ]
    )
    upload = client.post(path + "/files/thunderstorm", files={"file": ("10min.txt", measured)})
    assert upload.status_code == 200, upload.text
    options["extreme"]["thunderstorm"]["source_id"] = upload.json()["id"]
    response = client.post(path + "/runs", json=options)
    assert response.status_code == 200, response.text
    extreme = client.get(f"{path}/runs/{response.json()['id']}").json()["extreme"]
    alpha = 1.2 / stdev(block_sizes)
    site_speed = mean(block_sizes) - 0.55 / alpha - log(-log1p(-1 / (50 * 73))) / alpha
    assert extreme["thunderstorm"]["site_speed"] == pytest.approx(site_speed)
    assert extreme["thunderstorm"]["sample_size"] == 73
    assert extreme["adopted_method"] == "五日雷暴法"
    assert extreme["adopted"] == pytest.approx(site_speed * sqrt(1.2 / 1.225))
    report = client.post(
        "/api/v1/reports/templates/mesoscale/1.3.0/export",
        data={**options, "extreme": dumps(options["extreme"])},
    )
    assert report.status_code == 200
    paragraphs = [p.text for p in Document(BytesIO(report.content)).paragraphs]
    assert "（3）五日雷暴法【勾选并完成计算时输出本小节】" in paragraphs
    assert any("近20年平均风速为【20年平均风速】" in paragraph for paragraph in paragraphs)
    assert any(
        "（五日雷暴法）" in paragraph and "取其中最大值" in paragraph for paragraph in paragraphs
    )

    two_years = hourly + hourly[hourly.index("\n") + 1 :].replace("2023", "2022")
    source = client.post(path + "/files/source", files={"file": ("two-years.txt", two_years)})
    assert source.status_code == 200 and source.json()["window_years"] == 2
    options["source_id"] = source.json()["id"]
    missing_year = client.post(path + "/runs", json=options)
    assert missing_year.status_code == 422 and "完整自然年" in missing_year.json()["detail"]
    options["extreme"]["thunderstorm"]["year"] = 2023
    response = client.post(path + "/runs", json=options)
    assert response.status_code == 200, response.text
    combined = client.get(f"{path}/runs/{response.json()['id']}").json()
    assert combined["analysis_start_year"] == 2022
    assert combined["analysis_end_year"] == combined["extreme"]["thunderstorm"]["year"] == 2023


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


def test_assessment_recognizes_density_per_natural_year_without_requiring_valid_density_rows():
    raw = (
        "Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\tAir_Density_100m [kg/m³]\n"
        "2021-12-31 23:00\t4\t90\t1.08\n"
        "2022-01-01 00:00\t5\t95\t1.20\n"
        "2022-01-01 01:00\t6\t96\t1.24\n"
        "2022-01-01 02:00\t7\t97\t-999\n"
        "2022-01-01 03:00\t8\t98\t"
    ).encode()
    source = assessment_source(raw)
    assert source["density_by_year"] == {"2021": 1.08, "2022": pytest.approx(1.22)}
    assert source["density_constant"] is None
    assert source["last"] == "2022-01-01T03:00:00"


def test_assessment_uses_explicit_density_metadata_but_not_pressure_and_temperature():
    raw = (
        "Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\tPressure_0m [kPa]"
        "\tTemperature_2m [°C]\n2022-01-01 00:00\t4\t90\t89.9\t4.1"
    ).encode()
    source = assessment_source(raw)
    assert source["density_by_year"] == {}
    assert source["density_constant"] is None
    assert assessment_source(b"Air Density = 1.078 kg/m^3\n" + raw)["density_constant"] == 1.078
    assert assessment_source("空气密度（kg/m³）：1.08\n".encode() + raw)["density_constant"] == 1.08


def test_assessment_source_lookup_recognizes_density_in_older_upload(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    raw = (
        b"Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\tRho [kg/m3]\n"
        b"2022-01-01 00:00\t4\t90\t1.09"
    )
    store = app.state.wind_store
    saved = store.put(
        "assessment-files",
        {
            "kind": "source",
            "name": "legacy.txt",
            "sha256": store.original(raw),
        },
    )
    response = client.get("/api/v1/reports/assessment/files/source/" + saved["id"])
    assert response.status_code == 200
    assert response.json()["density_by_year"] == {"2022": 1.09}


def test_assessment_uses_highest_populated_layer_for_grade_and_hub_density(tmp_path):
    client = TestClient(create_app(tmp_path))
    raw = (
        b"Date/Time\tSpeed_100m [m/s]\tDirection_100m [Deg]\tSpeed_120m [m/s]\t"
        b"Direction_120m [Deg]\tSpeed_125m [m/s]\tDirection_125m [Deg]\t"
        b"Air Density_120m [kg/m3]\tAir Temperature_120m [K]\n"
        b"2025-01-01 00:00\t4\t90\t7\t90\t\t\t1.211\t288.15\n"
        b"2025-01-01 01:00\t5\t90\t8\t90\t\t\t1.211\t288.15\n"
        b"2025-12-31 23:00\t6\t90\t9\t90\t\t\t1.211\t288.15\n"
    )
    path = "/api/v1/reports/assessment"
    response = client.post(path + "/files/source", files={"file": ("wind.txt", raw)})
    assert response.status_code == 200, response.text
    source = response.json()
    assert source["height"] == 120
    assert source["density_period"] == pytest.approx(1.211)
    assert source["temperature_period"] == pytest.approx(15)
    options = {"source_id": source["id"], "density": 1.211, "hub_height_m": 125}
    response = client.post(path + "/runs", json=options)
    assert response.status_code == 200, response.text
    output = client.get(f"{path}/runs/{response.json()['id']}").json()
    adjustment = output["density_adjustment"]
    assert adjustment["hub_density"] == pytest.approx(1.21028539)
    assert adjustment["temperature_source"] == "file"
    assert output["extreme"]["density"] == adjustment["hub_density"]
    assert output["power_density_grade"]["height_m"] == 120
    assert output["power_density_grade"]["grade"] == "2"
    assert output["power_density_grade"]["power_density"] == pytest.approx(319.704)
    report = client.post(
        "/api/v1/reports/templates/mesoscale/1.2.0/export",
        data={**options, "extreme": dumps({"pressure_override": 0.45})},
    )
    assert report.status_code == 200
    paragraphs = [p.text for p in Document(BytesIO(report.content)).paragraphs]
    assert any("轮毂高度 125 m 处的空气密度为 1.210285" in p for p in paragraphs)
    assert any("场址风功率密度等级及风能资源评价：2 级。" == p for p in paragraphs)
    no_temperature = raw.replace(b"288.15", b"")
    source = client.post(
        path + "/files/source", files={"file": ("no-temp.txt", no_temperature)}
    ).json()
    options["source_id"] = source["id"]
    assert client.post(path + "/runs", json=options).status_code == 422
    assert (
        client.post(path + "/runs", json={**options, "mean_temperature_c": 15}).status_code == 200
    )


@pytest.mark.parametrize(
    ("height", "power_density", "grade"),
    [
        (100, 409.99, "2"),
        (100, 410, "3"),
        (110, 430, "3"),
        (120, 2750, "7"),
        (120, 2750.1, None),
        (125, 450, "3"),
        (160, 300, "2"),
        (9, 100, None),
    ],
)
def test_assessment_power_density_grade_boundaries(height, power_density, grade):
    assert classify_power_density(height, power_density)["grade"] == grade
