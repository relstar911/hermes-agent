import hmac
from unittest import mock
from fastapi.testclient import TestClient

def _client_and_token():
    import hermes_cli.web_server as ws
    return TestClient(ws.app), ws._SESSION_TOKEN

def test_eden_tts_requires_token():
    client, _ = _client_and_token()
    r = client.post("/api/eden/tts", json={"text": "hallo"})
    assert r.status_code == 401

def test_eden_tts_returns_mp3_bytes():
    import hermes_cli.web_server as ws
    client, token = _client_and_token()
    fake_json = '{"success": true, "file_path": "FAKE"}'
    with mock.patch("tools.tts_tool.text_to_speech_tool", return_value=fake_json) as m, \
         mock.patch("pathlib.Path.read_bytes", return_value=b"ID3MP3DATA"):
        r = client.post(f"/api/eden/tts?token={token}", json={"text": "hallo welt"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3MP3DATA"
    assert m.call_args.args[0] == "hallo welt"

def test_eden_tts_empty_text_400():
    client, token = _client_and_token()
    r = client.post(f"/api/eden/tts?token={token}", json={"text": "  "})
    assert r.status_code == 400
