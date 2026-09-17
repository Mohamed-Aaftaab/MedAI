import pytest
from fastapi.testclient import TestClient

import app
from medai_readback.local_api import workflow
from medai_readback.calle import CalleService
from medai_readback.keeperhub import KeeperHubClient

MED = dict(name='Medicine A', dosage='10mg', quantity='1', schedule=['MORNING'],
           duration='2 days', instructions='after food')

RECIPIENT = '0x' + '1' * 40


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDAI_DB_PATH', str(tmp_path / 'campaigns.sqlite3'))
    monkeypatch.setenv('MEDAI_STAFF_TOKEN', 's' * 40)
    monkeypatch.setenv('MEDAI_TENANT_ID', 'test')
    monkeypatch.setenv('CALLE_VERIFIED_LOCALES', 'en-IN')
    monkeypatch.setenv('CALLE_ENABLE_LIVE_CALLS', 'true')
    monkeypatch.setenv('CALLE_ALLOWED_PHONES', '+12025550123')
    monkeypatch.setenv('CALLE_CALL_BUDGET', '5')
    monkeypatch.setenv('MEDAI_PUBLIC_BASE_URL', 'https://example.test')
    monkeypatch.setenv('KEEPERHUB_API_KEY', 'kh_test_key')
    monkeypatch.setenv('KEEPERHUB_RECIPIENT_ADDRESS', RECIPIENT)
    monkeypatch.setenv('KEEPERHUB_TRANSFER_AMOUNT_ETH', '0.0005')
    monkeypatch.setenv('KEEPERHUB_CHAIN_ID', '11155111')
    monkeypatch.setenv('KEEPERHUB_ENABLE_PAYMENTS', 'true')
    monkeypatch.setenv('KEEPERHUB_WEBHOOK_SECRET', 'w' * 40)
    with TestClient(app.app, headers={'Authorization': 'Bearer ' + 's' * 40}) as c:
        yield c


def seed(client):
    assert client.put('/local/patients', json=dict(
        patient_id='p1', name='Test Patient', phone='+12025550123',
        language='en-IN', region='IN', consent=True,
        consent_evidence='Explicit test consent')).status_code == 200
    r = client.post('/local/intakes', json=dict(patient_id='p1', source_id='source1', medications=[MED]))
    assert r.status_code == 200, r.text
    return r.json()


class FakeCalleService:
    def __init__(self):
        self.calls = []

    async def call(self, **kwargs):
        self.calls.append(kwargs)
        return {'call_sid': 'call_test'}


class FakeKeeperHubClient:
    def __init__(self, simulate_ok=True, would_revert=False, execution_id='exec_1', status_code=202):
        self.simulate_ok = simulate_ok
        self.would_revert = would_revert
        self.execution_id = execution_id
        self.status_code = status_code
        self.calls = []
        # Field names match KeeperHub's own DirectExecutionReceiptEntry type
        # (lib/db/schema-extensions.ts): a receipt's hash field is `hash`,
        # not `transactionHash` (that name is reserved for the top-level
        # execution field self-reported at broadcast time).
        self.status_response = {'status': 'completed', 'receipts': [
            {'verified': True, 'receiptStatus': 'success', 'hash': '0xabc', 'blockNumber': 123, 'gasUsed': '21000'}
        ]}

    async def transfer(self, recipient_address, amount, chain_id=None, simulate=False, idempotency_key=None):
        self.calls.append(dict(recipient_address=recipient_address, amount=amount,
                                chain_id=chain_id, simulate=simulate, idempotency_key=idempotency_key))
        if simulate:
            return {'status_code': 200 if self.simulate_ok else 400,
                     'success': self.simulate_ok, 'wouldRevert': self.would_revert}
        return {'status_code': self.status_code, 'success': True,
                 'executionId': self.execution_id, 'status': 'pending'}

    async def get_execution_status(self, execution_id):
        assert execution_id == self.execution_id
        return self.status_response


def install_fakes(monkeypatch, calle=None, keeperhub=None):
    calle = calle or FakeCalleService()
    keeperhub = keeperhub or FakeKeeperHubClient()

    async def calle_provider():
        return calle

    async def keeperhub_provider():
        return keeperhub

    monkeypatch.setattr(CalleService, 'get_instance', calle_provider)
    monkeypatch.setattr(KeeperHubClient, 'get_instance', keeperhub_provider)
    return calle, keeperhub


def test_readiness_reports_blockers_with_no_config(client, monkeypatch):
    for name in ('KEEPERHUB_API_KEY', 'KEEPERHUB_RECIPIENT_ADDRESS',
                 'KEEPERHUB_TRANSFER_AMOUNT_ETH', 'KEEPERHUB_ENABLE_PAYMENTS'):
        monkeypatch.delenv(name, raising=False)
    body = client.get('/campaigns/readiness').json()
    assert body['configured_for_payment'] is False
    assert body['keeperhub_blockers']


def test_pay_and_call_happy_path(client, monkeypatch):
    calle, keeperhub = install_fakes(monkeypatch)
    doc = seed(client)
    key = doc['call_id']

    r = client.post(f'/campaigns/{key}/pay')
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['payment']['payment_state'] == 'submitted'
    assert body['payment']['payment_execution_id'] == 'exec_1'
    assert body['call']['dispatch_state'] == 'submitted'
    assert body['call']['provider_id'] == 'call_test'

    assert len(keeperhub.calls) == 2  # simulate, then broadcast
    assert keeperhub.calls[0]['simulate'] is True
    assert keeperhub.calls[1]['simulate'] is False
    assert keeperhub.calls[1]['idempotency_key']
    assert len(calle.calls) == 1


def test_pay_and_call_rejects_double_payment(client, monkeypatch):
    install_fakes(monkeypatch)
    doc = seed(client)
    key = doc['call_id']
    assert client.post(f'/campaigns/{key}/pay').status_code == 200
    r = client.post(f'/campaigns/{key}/pay')
    assert r.status_code == 409


def test_simulation_revert_blocks_broadcast_and_call(client, monkeypatch):
    keeperhub = FakeKeeperHubClient(simulate_ok=False, would_revert=True)

    class Forbidden:
        async def call(self, **kw):
            raise AssertionError('must not place a call when simulation reverts')
    install_fakes(monkeypatch, calle=Forbidden(), keeperhub=keeperhub)
    doc = seed(client)
    key = doc['call_id']

    r = client.post(f'/campaigns/{key}/pay')
    assert r.status_code == 502
    assert len(keeperhub.calls) == 1  # only the simulate call, no broadcast
    assert workflow().get('confirmation', key).get('payment_state') is None


def test_payment_reconcile_reads_receipt(client, monkeypatch):
    install_fakes(monkeypatch)
    doc = seed(client)
    key = doc['call_id']
    assert client.post(f'/campaigns/{key}/pay').status_code == 200

    r = client.post(f'/campaigns/{key}/payment/reconcile')
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['payment_verified'] is True
    assert body['payment_receipt_status'] == 'success'
    assert body['payment_tx_hash'] == '0xabc'


def test_keeperhub_webhook_requires_correct_secret(client, monkeypatch):
    calle, _ = install_fakes(monkeypatch)
    doc = seed(client)
    key = doc['call_id']

    wrong = client.post('/campaigns/keeperhub-webhook/wrong-secret', json={'call_id': key})
    assert wrong.status_code == 403
    assert calle.calls == []

    right = client.post('/campaigns/keeperhub-webhook/' + 'w' * 40, json={'call_id': key})
    assert right.status_code == 200, right.text
    assert right.json()['dispatch_state'] == 'submitted'
    assert len(calle.calls) == 1
