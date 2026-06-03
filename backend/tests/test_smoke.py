"""Smoke tests — ensure the app can start and basic endpoints respond."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    # Enter the context manager so the app's lifespan runs on startup — this
    # applies the additive schema migrations (e.g. the audio_kind column, ADR-005)
    # to the configured DB. Without it the lifespan never fires and a newly-added
    # model column is missing from the table the endpoints query (OperationalError).
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    """The health endpoint should return 200 with version info."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "ollama_connected" in data


def test_list_memos_endpoint(client):
    """The memos list endpoint should return 200 with items array."""
    response = client.get("/api/memos")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
