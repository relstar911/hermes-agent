"""Tests for POST /api/eden/stt (ElevenLabs Scribe transcription)."""
from unittest.mock import MagicMock, patch


def _client_and_token():
    import hermes_cli.web_server as ws
    from fastapi.testclient import TestClient
    return TestClient(ws.app), ws._SESSION_TOKEN


def _token_headers():
    _, token = _client_and_token()
    return {"x-hermes-session-token": token}


# ---------------------------------------------------------------------------
# fixtures (module-level helpers, mirroring test_eden_tts_endpoint.py style)
# ---------------------------------------------------------------------------

import pytest

@pytest.fixture()
def client():
    c, _ = _client_and_token()
    return c

@pytest.fixture()
def token_headers():
    return _token_headers()


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_stt_requires_token(client):
    r = client.post("/api/eden/stt", content=b"x" * 2048)
    assert r.status_code == 401


def test_stt_rejects_tiny_body(client, token_headers):
    r = client.post("/api/eden/stt", content=b"x" * 100, headers=token_headers)
    assert r.status_code == 400


def test_stt_503_without_key(client, token_headers):
    with patch("hermes_cli.web_server._eden_stt_api_key", return_value=""):
        r = client.post("/api/eden/stt", content=b"x" * 2048, headers=token_headers)
    assert r.status_code == 503


def test_stt_happy_path(client, token_headers):
    fake_result = MagicMock()
    fake_result.text = " Hallo EDEN. "
    fake_client = MagicMock()
    fake_client.speech_to_text.convert.return_value = fake_result
    with patch("hermes_cli.web_server._eden_stt_api_key", return_value="k"), \
         patch("elevenlabs.client.ElevenLabs", return_value=fake_client):
        r = client.post(
            "/api/eden/stt?language=de",
            content=b"x" * 2048,
            headers=token_headers,
        )
    assert r.status_code == 200
    assert r.json() == {"text": "Hallo EDEN."}
    kwargs = fake_client.speech_to_text.convert.call_args.kwargs
    assert kwargs["model_id"] == "scribe_v1"
    assert kwargs["language_code"] == "de"
