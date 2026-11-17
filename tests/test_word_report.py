"""Check the exported Word package, template insertion and source lineage through the API."""

import base64
import json
from io import BytesIO

import pytest
from docx import Document
from fastapi.testclient import TestClient
from wind_platform.main import create_app

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2"
    "FzhVAAAAAElFTkSuQmCC"
)


@pytest.fixture
def source(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        run = client.app.state.wind_store.put(
            "runs",
            {
                "kind": "analysis",
                "config": {},
                "sources": {"result": {"tower_id": "tower-example"}},
                "outputs": {
                    "monthly": {
                        "title": "风速月变化",
                        "method": "wind-statistics",
                        "status": "ready",
                        "rows": [{"period": "2025-03", "mean_speed": 4.72}],
                    },
                    "density": {
                        "title": "空气密度",
                        "method": "air-density",
                        "status": "unavailable",
                        "reason": "缺少温压资料",
                    },
                },
            },
        )
        yield client, run


def export(client, section, *, template=None, image=None):
    parts = [
        ("manifest", (None, json.dumps({"title": "测试风场", "sections": [section]}))),
    ]
    if template is not None:
        parts.append(("template", ("模板.docx", template)))
    if image is not None:
        parts.append(("images", ("图.png", image, "image/png")))
    return client.post("/api/v1/reports/docx", files=parts)


def make_template(markers):
    doc = Document()
    doc.sections[0].header.paragraphs[0].text = "模板页眉"
    doc.add_paragraph("地理位置")
    for _ in range(markers):
        marker = doc.add_paragraph()
        marker.add_run("{{风资")
        marker.add_run("源分析}}").bold = True
    doc.add_paragraph("工程地质")
    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def test_default_docx_uses_archived_values_and_embeds_chart(source):
    client, run = source
    section = {
        "run_id": run["id"],
        "output_id": "monthly",
        "figures": [{"index": 0, "caption": "100 m 风速"}],
    }
    response = export(client, section, image=PNG)
    assert response.status_code == 200, response.text[:300]
    assert "wordprocessingml.document" in response.headers["content-type"]
    doc = Document(BytesIO(response.content))
    cells = [
        cell.text for table in doc.tables for row in table.rows for cell in row.cells
    ]
    assert "2025-03" in cells
    assert "4.72" in cells
    assert len(doc.inline_shapes) == 1
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "100 m 风速" in text
    assert run["id"] in text
    assert client.get(f"/api/v1/runs/{run['id']}").json() == run


def test_template_inserts_at_split_marker_and_preserves_surroundings(source):
    client, run = source
    section = {
        "run_id": run["id"],
        "output_id": "monthly",
        "title": "选定高度的月变化",
        "tables": [{"headers": ["月份", "风速"], "rows": [["三月", "4.72"]]}],
    }
    response = export(client, section, template=make_template(1))
    assert response.status_code == 200, response.text[:300]
    doc = Document(BytesIO(response.content))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert (
        text.index("地理位置") < text.index("选定高度的月变化") < text.index("工程地质")
    )
    assert "{{风资源分析}}" not in text
    assert doc.sections[0].header.paragraphs[0].text == "模板页眉"
    assert any(
        [cell.text for cell in row.cells] == ["三月", "4.72"]
        for table in doc.tables
        for row in table.rows
    )


@pytest.mark.parametrize("marker_count", [0, 2])
def test_template_requires_one_unambiguous_insertion_point(source, marker_count):
    client, run = source
    response = export(
        client,
        {"run_id": run["id"], "output_id": "monthly"},
        template=make_template(marker_count),
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "case", ["unknown-run", "unknown-output", "unavailable", "absent-image"]
)
def test_export_rejects_unresolved_sections(source, case):
    client, run = source
    section = {
        "run_id": "f" * 32 if case == "unknown-run" else run["id"],
        "output_id": {"unknown-output": "bad", "unavailable": "density"}.get(
            case, "monthly"
        ),
    }
    if case == "absent-image":
        section["figures"] = [{"index": 0}]
    assert export(client, section).status_code == 422
