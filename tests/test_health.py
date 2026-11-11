"""验证前后端共享的 API 契约，以及文档路由。"""

from fastapi.testclient import TestClient
from wind_platform.main import create_app


def test_health_contract() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "aeolus-wra",
        "version": "0.1.0",
    }


def test_openapi_exposes_versioned_health_route() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "/api/v1/health" in response.json()["paths"]


def test_unimplemented_endpoint_returns_not_found() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/datasets")
    assert response.status_code == 404
