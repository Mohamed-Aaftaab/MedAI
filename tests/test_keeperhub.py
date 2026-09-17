import pytest
import httpx

from medai_readback.keeperhub import KeeperHubClient, KeeperHubError


@pytest.fixture(autouse=True)
def reset_singleton():
    # A plain (non-async) fixture: shutdown() is async, but MockTransport
    # holds no real connection to close, so resetting the class attribute
    # directly avoids depending on async-fixture support this suite doesn't
    # otherwise use.
    KeeperHubClient._instance = None
    yield
    KeeperHubClient._instance = None


def _client_with_transport(handler, monkeypatch):
    monkeypatch.setenv("KEEPERHUB_API_KEY", "kh_test_key")

    async def init_client(self):
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url="https://app.keeperhub.com",
                transport=httpx.MockTransport(handler),
            )
    monkeypatch.setattr(KeeperHubClient, "_init_client", init_client)


@pytest.mark.asyncio
async def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("KEEPERHUB_API_KEY", raising=False)
    client = await KeeperHubClient.get_instance()
    with pytest.raises(ValueError):
        await client.transfer("0x" + "1" * 40, "0.001", simulate=True)


@pytest.mark.asyncio
async def test_simulate_sends_flag_and_no_idempotency_key(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["headers"] = request.headers
        captured["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"success": True, "wouldRevert": False})

    _client_with_transport(handler, monkeypatch)
    client = await KeeperHubClient.get_instance()
    result = await client.transfer("0x" + "1" * 40, "0.001", chain_id="11155111", simulate=True)

    assert result["success"] is True
    assert captured["json"]["simulate"] is True
    assert "Idempotency-Key" not in captured["headers"]
    assert captured["headers"]["Authorization"] == "Bearer kh_test_key"


@pytest.mark.asyncio
async def test_broadcast_sends_idempotency_key(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(202, json={"success": True, "executionId": "exec_1", "status": "pending"})

    _client_with_transport(handler, monkeypatch)
    client = await KeeperHubClient.get_instance()
    result = await client.transfer("0x" + "1" * 40, "0.001", idempotency_key="stable-key-1")

    assert result["status_code"] == 202
    assert result["executionId"] == "exec_1"
    assert captured["headers"]["Idempotency-Key"] == "stable-key-1"


@pytest.mark.asyncio
async def test_dry_run_failure_body_is_returned_not_raised(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"success": False, "wouldRevert": True, "code": "insufficient_balance"})

    _client_with_transport(handler, monkeypatch)
    client = await KeeperHubClient.get_instance()
    result = await client.transfer("0x" + "1" * 40, "1000", simulate=True)

    assert result["status_code"] == 400
    assert result["wouldRevert"] is True


@pytest.mark.asyncio
async def test_get_execution_status_raises_on_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    _client_with_transport(handler, monkeypatch)
    client = await KeeperHubClient.get_instance()
    with pytest.raises(KeeperHubError):
        await client.get_execution_status("exec_missing")


@pytest.mark.asyncio
async def test_get_execution_status_returns_body(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/execute/exec_1/status"
        return httpx.Response(200, json={"status": "completed", "receipts": [
            {"verified": True, "receiptStatus": "success", "transactionHash": "0xabc"}
        ]})

    _client_with_transport(handler, monkeypatch)
    client = await KeeperHubClient.get_instance()
    result = await client.get_execution_status("exec_1")

    assert result["status"] == "completed"
    assert result["receipts"][0]["verified"] is True


@pytest.mark.asyncio
async def test_trigger_workflow_requires_webhook_key_not_api_key(monkeypatch):
    # KEEPERHUB_API_KEY (kh_) is set by _client_with_transport, but the
    # workflow-webhook endpoint requires a distinct wfb_ webhook key
    # (verified against KeeperHub's own source — see keeperhub.py). Without
    # KEEPERHUB_WEBHOOK_KEY this must fail locally, not send a kh_ key that
    # the real endpoint would reject with 401 wrong_key_type.
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not make a request without a webhook key")

    _client_with_transport(handler, monkeypatch)
    monkeypatch.delenv("KEEPERHUB_WEBHOOK_KEY", raising=False)
    client = await KeeperHubClient.get_instance()
    with pytest.raises(ValueError):
        await client.trigger_workflow("wf_1", {"call_id": "abc"})


@pytest.mark.asyncio
async def test_trigger_workflow_posts_to_workflow_webhook_with_webhook_key(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["headers"] = request.headers
        import json as _json
        captured["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"executionId": "exec_2", "status": "running"})

    _client_with_transport(handler, monkeypatch)
    monkeypatch.setenv("KEEPERHUB_WEBHOOK_KEY", "wfb_test_webhook_key")
    client = await KeeperHubClient.get_instance()
    result = await client.trigger_workflow("wf_1", {"call_id": "abc"}, idempotency_key="k1")

    assert captured["path"] == "/api/workflows/wf_1/webhook"
    assert captured["json"] == {"call_id": "abc"}
    assert captured["headers"]["Authorization"] == "Bearer wfb_test_webhook_key"
    assert captured["headers"]["Idempotency-Key"] == "k1"
    assert result["executionId"] == "exec_2"
