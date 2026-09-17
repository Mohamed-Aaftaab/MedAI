"""Postgres-backend parity tests.

Proves the Postgres migration actually preserves the SQLite backend's
guarantees - especially the concurrent-reservation race protection that
BEGIN IMMEDIATE used to provide for free and pg_advisory_xact_lock now
stands in for. Skipped unless TEST_DATABASE_URL is set to a real Postgres
connection string, so verify.py's offline suite is unaffected.

Run once you have a real database:
    TEST_DATABASE_URL=postgresql://... python -m pytest tests/test_workflow_postgres.py -v
"""
import os
import secrets
from concurrent.futures import ThreadPoolExecutor

import pytest

DSN = os.getenv('TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='TEST_DATABASE_URL not set - skipping live Postgres tests')

if DSN:
    from medai_readback.workflow import Workflow, WorkflowError, Patient, Intake

MED = dict(name='Medicine A', dosage='10mg', quantity='1', schedule=['MORNING'], duration='2 days', instructions='after food')


@pytest.fixture
def flow():
    # A fresh random tenant AND a fresh random patient_id per test: the
    # database persists across test runs (unlike the SQLite suite's
    # tmp_path, a fresh empty file every time), and records' primary key is
    # (kind, id) - global, not scoped per tenant. Reusing a fixed 'p1'
    # across runs would collide with a previous run's patient under a
    # different tenant and correctly trip the tenant-ownership guard.
    tenant = 'pgtest-' + secrets.token_hex(6)
    patient_id = 'p-' + secrets.token_hex(6)
    f = Workflow(DSN, tenant)
    assert f.postgres, 'expected the postgres:// DSN to select the Postgres backend'
    f.patient(Patient(patient_id=patient_id, name='Test Patient', phone='+12025550123',
                       language='en-IN', region='IN', consent=True, consent_evidence='Test consent'), 'tester')
    f.patient_id = patient_id
    return f


def intake(flow, locales={'en-IN'}):
    return flow.intake(Intake(patient_id=flow.patient_id, source_id='scan1', medications=[MED]), locales)


def test_basic_roundtrip(flow):
    d = intake(flow)
    assert flow.get('confirmation', d['call_id'])['patient_name'] == 'Test Patient'
    assert flow.list('patient')[0]['patient_id'] == flow.patient_id


def test_reopening_the_same_dsn_sees_the_same_data(flow):
    """The whole point of the migration: unlike Vercel's ephemeral SQLite
    file, a second connection to the same DSN must see what the first wrote."""
    d = intake(flow)
    reopened = Workflow(DSN, flow.tenant)
    assert reopened.get('confirmation', d['call_id'])['call_id'] == d['call_id']


def test_concurrent_dispatch_reserves_exactly_one_credit(flow):
    """The property the advisory lock exists to guarantee: under real
    concurrent load against a real network database, budget=1 must never
    let more than one of many simultaneous reservations succeed. Mirrors
    test_workflow.py's SQLite version of this exact test."""
    d = intake(flow)

    def attempt(_):
        try:
            flow.reserve_call(d['call_id'], 1, {'+12025550123'})
            return True
        except WorkflowError:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(attempt, range(16))) == 1
    assert flow.budget() == 1


def test_tenant_isolation(flow):
    other = Workflow(DSN, 'pgtest-other-' + secrets.token_hex(6))
    with pytest.raises(WorkflowError):
        other.get('patient', flow.patient_id)


def test_the_previously_broken_job_cancellation_query_works(flow):
    """Regression check for the WHERE kind="job" bug: SQLite tolerated the
    double-quoted literal by falling back to string interpretation; Postgres
    would raise 'column "job" does not exist' if this ever regressed."""
    d = intake(flow)
    flow.patient(Patient(patient_id=flow.patient_id, name='Test Patient', phone='+12025550123',
                          language='en-IN', region='IN', consent=False,
                          consent_evidence='Withdrawn'), 'tester')
    # No exception means the WHERE kind=%s form executed correctly.
    assert flow.list('patient')[0]['consent'] is False
