"""Real PostgreSQL journal; fake Google guarantees no external services are touched."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Event
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from conftest import client_for, login
from test_uony import ready
from test_products import connect
from test_google_billing import BillingCloud, ACCOUNT
from app.google_billing_reports import BillingReportError
from app.google_billing_sync import GoogleBillingSync
from app.google_billing_sync_routes import routes
from app.google_billing_sync_store import cached_sync


class SyncCloud(BillingCloud):
    def __init__(self):
        super().__init__()
        self.enabled = True
        self.enables = 0
        self.requests = []
        self.enable_failure = None

    def request(self, token, method, url, body=None, params=None):
        self.requests.append((method, url))
        assert 'bigquery' not in url and 'generateContent' not in url
        if 'cloudresourcemanager' in url:
            return {'name':'projects/12345','projectId':'project-fixture','state':'ACTIVE'}
        if url.endswith(':enable'):
            assert method == 'POST' and url.endswith('appoptimize.googleapis.com:enable')
            self.enables += 1
            if self.enable_failure:
                raise BillingReportError(self.enable_failure)
            self.enabled = True
            return {'name':'operations/enable-one','done':True}
        if '/operations/' in url:
            return {'name':'operations/enable-one','done':True}
        assert method == 'GET' and url.endswith('/services/appoptimize.googleapis.com')
        return {'state':'ENABLED' if self.enabled else 'DISABLED'}


class Reports:
    def __init__(self):
        self.created = []
        self.polled = 0
        self.metadata_calls = 0
        self.reads = 0
        self.pending = False
        self.uncertain = False
        self.metadata_missing = False
        self.result = {'status':'available','currency':'EUR','consumptionEUR':'1.98','rowCount':1}
        self.after_read = None
        self.started = None
        self.release = None

    def create(self, token, project, identifier, start, end):
        self.created.append(identifier)
        assert project == 'project-fixture' and identifier.startswith('uonify-') and start < end
        if self.started:
            self.started.set()
            assert self.release.wait(5)
        if self.uncertain:
            raise BillingReportError('google_unavailable')
        return {'status':'pending' if self.pending else 'ready','operationName':'projects/project-fixture/locations/global/operations/one'}

    def poll(self, *args):
        self.polled += 1
        return {'status':'ready'}

    def metadata(self, *args):
        self.metadata_calls += 1
        if self.metadata_missing:
            raise BillingReportError('not_found')
        return {'status':'ready'}

    def read(self, *args):
        self.reads += 1
        if self.after_read:
            self.after_read()
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@contextmanager
def prepared(environment):
    config, google, db = environment
    cloud, reports = SyncCloud(), Reports()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        with db.connect() as c:
            uid = c.execute('SELECT id FROM users').fetchone()['id']
        yield client, db, GoogleBillingSync(config, db, cloud, reports), uid, cloud, reports


def due(db):
    with db.connect() as c:
        c.execute("UPDATE google_billing_sync SET next_check_at=now()-interval '1 second',lease_until=NULL")


def journal(db):
    with db.connect() as c:
        return c.execute('SELECT * FROM google_billing_sync').fetchone()


def test_unprepared_service_requires_explicit_preparation_and_never_enables(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        cloud.enabled = False
        first = service.sync(uid)
        assert first['status'] == 'needs_setup' and first['reason'] == 'service_disabled'
        assert first['consumptionEUR'] is None and first['canSync'] is True
        assert service.sync(uid)['status'] == 'needs_setup'
        assert cloud.enables == 0 and reports.created == []
        assert journal(db)['prepared_at'] is None


def test_preparation_is_journaled_once_and_next_request_finishes_same_report(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        cloud.enabled = False
        assert service.sync(uid, prepare=True)['status'] == 'pending'
        saved = journal(db)
        assert saved['service_state'] == 'enabling' and saved['prepared_at']
        assert cloud.enables == 1 and not reports.created
        assert service.sync(uid, prepare=True)['status'] == 'pending'
        assert cloud.enables == 1
        due(db)
        ready = service.sync(uid)
        assert ready['status'] == 'ready' and ready['consumptionEUR'] == '1.98'
        assert ready['source']['scope'] == 'project' and ready['source']['costBasis'] == 'gross_before_credits'
        assert reports.created == [saved['report_id']]
        assert cloud.enables == 1 and 'creditEUR' not in ready and 'netConsumptionEUR' not in ready


def test_pending_report_reloads_and_retries_do_not_duplicate_creation(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.pending = True
        assert service.sync(uid)['status'] == 'pending'
        identifier = journal(db)['report_id']
        assert service.sync(uid)['status'] == 'pending' and reports.polled == 0
        due(db)
        assert service.sync(uid)['status'] == 'ready'
        assert reports.created == [identifier] and reports.polled == 1 and reports.reads == 1
        assert service.sync(uid)['status'] == 'ready' and reports.reads == 1


def test_ambiguous_create_is_reconciled_by_same_id_and_never_recreated(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.uncertain = True
        assert service.sync(uid)['reason'] == 'report_unconfirmed'
        identifier = journal(db)['report_id']
        reports.metadata_missing = True
        due(db)
        assert service.sync(uid)['status'] == 'pending'
        reports.metadata_missing = False
        due(db)
        assert service.sync(uid)['status'] == 'ready'
        assert reports.created == [identifier] and reports.metadata_calls == 2 and reports.reads == 1


def test_no_records_is_unknown_not_zero_and_refreshes_only_after_one_hour(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.result = {'status':'no_records','currency':None,'consumptionEUR':None,'rowCount':0}
        result = service.sync(uid)
        assert result['status'] == 'no_records' and result['consumptionEUR'] is None and result['currency'] is None
        assert journal(db)['next_check_at'] - journal(db)['checked_at'] == timedelta(hours=1)
        assert service.sync(uid)['status'] == 'no_records' and len(reports.created) == 1
        due(db)
        service.sync(uid)
        assert len(set(reports.created)) == 2


def test_ready_cost_refreshes_after_six_hours_with_new_bounded_period(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        assert service.sync(uid)['status'] == 'ready'
        first = journal(db)
        assert first['next_check_at'] - first['checked_at'] == timedelta(hours=6)
        due(db)
        assert service.sync(uid)['status'] == 'ready'
        assert len(set(reports.created)) == 2
        assert journal(db)['period_end'] >= first['period_end']


@pytest.mark.parametrize('code', ['permission_denied','unsupported_currency','invalid_response','quota_exceeded'])
def test_provider_failure_hides_money_and_preserves_same_report_for_read_retry(environment,code):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.result = BillingReportError(code)
        failed = service.sync(uid)
        assert failed['status'] == 'error' and failed['reason'] == code and failed['consumptionEUR'] is None
        assert service.sync(uid)['status'] == 'error' and reports.reads == 1
        reports.result = {'status':'available','currency':'EUR','consumptionEUR':'0.00','rowCount':1}
        due(db)
        fixed = service.sync(uid)
        assert fixed['status'] == 'ready' and fixed['consumptionEUR'] == '0.00'
        assert len(reports.created) == 1


@pytest.mark.parametrize('change', ['project','billing','delete','revoke','disconnect'])
def test_late_result_cannot_publish_after_identity_project_or_access_change(environment,change):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        def switch():
            with db.connect() as c:
                if change == 'project': c.execute("UPDATE google_cloud_connections SET project_id='second-project'")
                if change == 'billing': cloud.account = 'billingAccounts/SECOND'
                if change == 'delete': c.execute('UPDATE users SET deletion_requested_at=now()')
                if change == 'revoke': c.execute('UPDATE access_periods SET ends_at=now()')
                if change == 'disconnect': c.execute('DELETE FROM google_cloud_connections')
        reports.after_read = switch
        with pytest.raises(HTTPException):
            service.sync(uid)
        assert journal(db)['status'] == 'error' and journal(db)['consumption_eur'] is None
        assert reports.reads == 1


def test_concurrent_double_click_has_one_report_and_busy_response(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.started, reports.release = Event(), Event()
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(service.sync,uid)
            assert reports.started.wait(5)
            try:
                with pytest.raises(HTTPException) as error:
                    service.sync(uid)
                assert error.value.detail['error'] == 'billing_sync_busy'
            finally:
                reports.release.set()
            assert first.result(5)['status'] == 'ready'
        assert len(reports.created) == 1


def test_cached_state_is_bound_to_account_project_identity_and_connection(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        service.sync(uid)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE id=%s',(uid,)).fetchone()
            row = c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',(uid,)).fetchone()
            assert cached_sync(c,user,row,ACCOUNT)['consumptionEUR'] == '1.98'
            assert cached_sync(c,user,row,'billingAccounts/OTHER') is None
            assert cached_sync(c,user,{**row,'project_id':'other-project'},ACCOUNT) is None
            assert cached_sync(c,user,{**row,'google_subject':'other-subject'},ACCOUNT) is None
            assert cached_sync(c,user,{**row,'connected_at':row['connected_at']+timedelta(seconds=1)},ACCOUNT) is None
        assert reports.reads == 1


def test_route_requires_session_origin_access_and_strict_body(environment):
    config, google, db = environment
    cloud,reports = SyncCloud(),Reports()
    with client_for(config,google,cloud=cloud) as original:
        ready(original,google,db);connect(db,config)
        app = FastAPI()
        app.include_router(routes(config,db,cloud,reports))
        with TestClient(app,base_url=config.origin) as client:
            client.headers['Origin'] = config.origin
            assert client.post('/api/uony/google-billing/sync',json={}).status_code == 401
            client.cookies.update(original.cookies)
            assert client.post('/api/uony/google-billing/sync',json={},headers={'Origin':'null'}).status_code == 403
            assert client.post('/api/uony/google-billing/sync',json={'projectId':'other-project'}).status_code == 422
            assert client.post('/api/uony/google-billing/sync',json={'prepare':'true'}).status_code == 422
            assert client.post('/api/uony/google-billing/sync',json={}).json()['sync']['status'] == 'ready'
            with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
            assert client.post('/api/uony/google-billing/sync',json={}).status_code == 403
            assert len(reports.created) == 1


def test_lost_create_has_one_bounded_same_name_retry_then_stops_automatic_polling(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.uncertain = reports.metadata_missing = True
        assert service.sync(uid)['status'] == 'pending'
        identifier = journal(db)['report_id']
        with db.connect() as c:
            c.execute("UPDATE google_billing_sync SET report_started_at=now()-interval '3 minutes'")
        due(db)
        assert service.sync(uid)['status'] == 'pending'
        assert journal(db)['report_state'] == 'reserved'
        due(db)
        assert service.sync(uid)['status'] == 'pending'
        assert reports.created == [identifier,identifier]
        with db.connect() as c:
            c.execute("UPDATE google_billing_sync SET report_started_at=now()-interval '3 minutes'")
        due(db)
        stopped = service.sync(uid)
        assert stopped['status'] == 'error' and stopped['reason'] == 'report_unconfirmed'
        due(db)
        assert service.sync(uid)['status'] == 'error' and reports.created == [identifier,identifier]


def test_lost_enable_stops_until_explicit_prepare_after_fresh_disabled_read(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        cloud.enabled = False
        cloud.enable_failure = 'google_unavailable'
        assert service.sync(uid,prepare=True)['status'] == 'error'
        assert journal(db)['service_state'] == 'enabling' and journal(db)['service_operation'] is None
        with db.connect() as c:
            c.execute("UPDATE google_billing_sync SET service_started_at=now()-interval '3 minutes'")
        due(db)
        result = service.sync(uid)
        assert result['status'] == 'error' and result['reason'] == 'service_unconfirmed'
        assert cloud.enables == 1 and reports.created == []
        cloud.enable_failure = None
        assert service.sync(uid,prepare=True)['status'] == 'pending'
        assert cloud.enables == 2
        due(db)
        assert service.sync(uid)['status'] == 'ready'
        assert len(reports.created) == 1


def test_long_running_report_stops_auto_polling_but_manual_review_keeps_same_id(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.pending = True
        service.sync(uid)
        identifier = journal(db)['report_id']
        with db.connect() as c:
            c.execute('UPDATE google_billing_sync SET attempts=19')
        original_poll = reports.poll
        reports.poll = lambda *args: {'status':'pending'}
        due(db)
        delayed = service.sync(uid)
        assert delayed['status'] == 'error' and delayed['reason'] == 'google_processing_delayed'
        reports.poll = original_poll
        due(db)
        assert service.sync(uid)['status'] == 'ready' and reports.created == [identifier]


@pytest.mark.parametrize('uncertain', [False,True])
def test_expired_operation_and_report_can_be_refreshed_after_conclusive_metadata_absence(environment,uncertain):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        reports.pending = True
        reports.uncertain = uncertain
        service.sync(uid)
        def missing(*args): raise BillingReportError('not_found')
        reports.poll = missing
        reports.metadata_missing = True
        with db.connect() as c:
            c.execute("UPDATE google_billing_sync SET report_started_at=now()-interval '25 hours'")
        due(db)
        assert service.sync(uid)['reason'] == 'report_expired'
        reports.pending = reports.metadata_missing = reports.uncertain = False
        due(db)
        assert service.sync(uid)['status'] == 'ready'
        assert len(set(reports.created)) == 2


def test_long_running_service_stops_automatic_polling_and_checks_actual_service_first(environment):
    with prepared(environment) as (_,db,service,uid,cloud,reports):
        cloud.enabled = False
        service.sync(uid,prepare=True)
        cloud.enabled = False
        original_request = cloud.request
        def still_running(token,method,url,*args):
            if '/operations/' in url: return {'name':'operations/enable-one','done':False}
            return original_request(token,method,url,*args)
        cloud.request = still_running
        with db.connect() as c:c.execute('UPDATE google_billing_sync SET attempts=19')
        due(db)
        assert service.sync(uid)['reason'] == 'google_processing_delayed'
        assert cloud.enables == 1
        cloud.enabled = True
        due(db)
        assert service.sync(uid)['status'] == 'ready' and cloud.enables == 1
