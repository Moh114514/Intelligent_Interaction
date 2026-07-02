from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app


TOKEN = "t" * 64


def make_client() -> TestClient:
    settings = Settings(
        host="127.0.0.1",
        port=8765,
        auth_token=TOKEN,
        log_dir=Path("backend/logs/tests"),
    )
    return TestClient(create_app(settings))


def test_health_requires_token() -> None:
    with make_client() as client:
        assert client.get("/health").status_code == 401
        response = client.get("/health", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_version_reports_protocol() -> None:
    with make_client() as client:
        response = client.get("/version", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.json() == {"version": "0.1.0", "protocol_version": "1.0"}


def test_websocket_echo_and_rejects_unknown_event() -> None:
    with make_client() as client:
        with client.websocket_connect(
            "/ws/v1", subprotocols=["agent.v1", TOKEN]
        ) as websocket:
            event = {
                "type": "diagnostics.echo.request",
                "version": "1.0",
                "session_id": "session-1",
                "request_id": "request-1",
                "timestamp": "2026-07-01T00:00:00+00:00",
                "data": {"message": "ping"},
            }
            websocket.send_json(event)
            echoed = websocket.receive_json()
            assert echoed["type"] == "diagnostics.echo.response"
            assert echoed["request_id"] == event["request_id"]
            assert echoed["data"] == {"echo": event["data"]}

            websocket.send_json({**event, "type": "unknown"})
            error = websocket.receive_json()
            assert error["type"] == "error"
            assert error["data"]["error_code"] == "UNSUPPORTED_EVENT"

            websocket.send_json({"type": "diagnostics.echo.request"})
            invalid = websocket.receive_json()
            assert invalid["type"] == "error"
            assert invalid["data"]["error_code"] == "INVALID_EVENT"

            websocket.send_text("{not-json")
            invalid_json = websocket.receive_json()
            assert invalid_json["data"]["error_code"] == "INVALID_EVENT"

            websocket.send_json(event)
            recovered = websocket.receive_json()
            assert recovered["type"] == "diagnostics.echo.response"
            assert recovered["request_id"] == event["request_id"]
