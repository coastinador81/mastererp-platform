"""Los checkpoints sólo escriben cobertura cambiada y mantienen el cerrojo de lease."""
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4
import pytest
from app.product_materials_queue import LeaseLost
from app.product_materials_worker import snapshot
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import FolderDrive
from test_product_materials_durable import prepare


def source_rows(db, job):
    with db.connect() as c:
        return {r['source_id']: r for r in c.execute(
            'SELECT source_id,data,updated_at FROM product_material_sources WHERE job_id=%s', (job,)).fetchall()}


@pytest.fixture
def snapshot_job(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('snapshot-test', job['id'])
        args = (row['id'], user['id'], row['lease_token'])
        for identifier in ('primary', 'other', 'copy'):
            source = {'id': identifier, 'name': identifier, 'version': 'v1', 'readComplete': True,
                      'status': 'read', 'warnings': ['Aviso del lector']}
            if identifier == 'copy':
                source.update(status='duplicate', duplicateOf='primary')
            service.queue.save_source(*args, source, 'v1')
        for identifier, source, state in [('first', 'primary', 'done'), ('second', 'primary', 'pending'), ('fixed', 'other', 'done')]:
            service.queue.put_fragment(*args, {'id': identifier, 'sourceId': source, 'version': 'v1',
                                             'payload': {'segments': []}})
            service.queue.finish_fragment(*args, identifier, state, {
                'observations': {source: identifier}, 'warnings': ['Aviso ' + identifier] if state == 'done' else []})
        yield service, user, row, args, db


def test_snapshot_only_writes_changed_sources_and_persists_duplicate_status(snapshot_job):
    service, user, row, args, db = snapshot_job
    result = {}
    with patch.object(service.queue, 'save_source', wraps=service.queue.save_source) as write:
        snapshot(service, row, user['id'], result)
        assert write.call_count == 3
        initial = source_rows(db, row['id'])
        assert initial['primary']['data']['status'] == 'awaiting_analysis'
        assert initial['primary']['data']['fragmentCoverage'] == {'total': 2, 'done': 1}
        assert initial['primary']['data']['summary'] == 'first second'
        assert initial['primary']['data']['warnings'] == ['Aviso del lector', 'Aviso first']
        assert initial['copy']['data']['status'] == 'partial'
        before = deepcopy(result)
        write.reset_mock()
        snapshot(service, row, user['id'], result)
        assert write.call_count == 0 and result == before
        assert source_rows(db, row['id']) == initial

        service.queue.finish_fragment(*args, 'second', 'partial', {
            'observations': {'primary': 'Ampliación con detalle'}, 'warnings': ['Revisar detalle']})
        snapshot(service, row, user['id'], result)
        assert write.call_count == 1
        partial = source_rows(db, row['id'])
        assert partial['primary']['data']['status'] == 'partial'
        assert partial['primary']['data']['fragmentCoverage'] == {'total': 2, 'done': 2}
        assert partial['primary']['data']['summary'] == 'first Ampliación con detalle'
        assert partial['primary']['data']['warnings'][-1] == 'Revisar detalle'
        assert partial['other'] == initial['other'] and partial['copy'] == initial['copy']

        service.queue.finish_fragment(*args, 'second', 'done', {'warnings': []})
        write.reset_mock()
        snapshot(service, row, user['id'], result)
        assert write.call_count == 2
        final = source_rows(db, row['id'])
        assert final['primary']['data']['status'] == 'analyzed'
        assert final['copy']['data']['status'] == 'duplicate'
        assert final['other'] == initial['other']
        assert result['coverage']['fragmentsDone'] == 3
        assert result['coverage']['fragmentsPending'] == 0
        assert result['unreviewed'] == 0


def test_snapshot_change_cannot_be_saved_by_stale_lease(snapshot_job):
    service, user, row, _, db = snapshot_job
    before = source_rows(db, row['id'])
    with pytest.raises(LeaseLost):
        snapshot(service, {**row, 'lease_token': uuid4()}, user['id'], {})
    assert source_rows(db, row['id']) == before


def test_unchanged_snapshot_still_requires_live_lease_for_job_checkpoint(snapshot_job):
    service, user, row, _, db = snapshot_job
    result = {}
    snapshot(service, row, user['id'], result)
    before = source_rows(db, row['id'])
    stale = {**row, 'lease_token': uuid4()}
    with patch.object(service.queue, 'save_source', wraps=service.queue.save_source) as write:
        snapshot(service, stale, user['id'], result)
        assert write.call_count == 0
        with pytest.raises(LeaseLost):
            service.queue.checkpoint(row['id'], user['id'], stale['lease_token'], result)
    assert source_rows(db, row['id']) == before
