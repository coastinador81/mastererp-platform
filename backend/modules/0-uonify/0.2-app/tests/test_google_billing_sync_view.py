"""The existing usage panel reads verified reports without creating them on GET."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from conftest import client_for
from test_google_billing import BillingCloud, save, ACCOUNT
from test_products import connect
from test_uony import ready, Agent


def seed_report(db, status='ready', **changes):
    now = datetime.now(timezone.utc)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users ORDER BY created_at LIMIT 1').fetchone()
        cloud = c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user['id'],)).fetchone()
        values = {'subject': user['google_subject'], 'project': cloud['project_id'],
                  'account': ACCOUNT, 'connected': cloud['connected_at'], 'amount': '0.00',
                  'checked': now, 'next': now+timedelta(hours=6), **changes}
        c.execute('''INSERT INTO google_billing_sync(id,user_id,google_subject,project_id,billing_account_name,
            connected_at,status,report_id,period_start,period_end,checked_at,next_check_at,consumption_eur,currency)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (uuid4(),user['id'],values['subject'],values['project'],values['account'],values['connected'],status,
             'uonify-test', now-timedelta(days=5),now-timedelta(hours=1),values['checked'],values['next'],
             values['amount'] if status=='ready' else None,'EUR' if status=='ready' else None))
    return values


def test_automatic_report_has_project_scope_and_no_invented_credit(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud, uony=Agent()) as client:
        ready(client, google, db); connect(db, config)
        row = seed_report(db)
        data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'available'
        assert data['creditEUR'] is None and data['consumptionEUR'] == '0.00'
        assert data['netConsumptionEUR'] is None and data['consumptionScope'] == 'project'
        assert data['source']['kind'] == 'google_app_optimize'
        assert data['source']['costBasis'] == 'gross_before_credits'
        assert datetime.fromisoformat(data['observedAt']) == row['checked']
        assert data['sync']['status'] == 'ready'
        client.get('/api/uony/google-billing')
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM google_billing_sync').fetchone()['n'] == 1


def test_automatic_consumption_does_not_rejuvenate_manual_credit(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud, uony=Agent()) as client:
        ready(client, google, db); connect(db, config)
        observed = datetime.now(timezone.utc)-timedelta(days=2)
        save(db, config, cloud, observedAt=observed.isoformat())
        report = seed_report(db, amount='3.45')
        data = client.get('/api/uony/google-billing').json()
        assert data['creditEUR'] == '262.02' and data['creditStale'] is True
        assert datetime.fromisoformat(data['creditObservedAt']) == observed
        assert data['creditSource']['kind'] == 'observed_google_console'
        assert data['consumptionEUR'] == '3.45'
        assert datetime.fromisoformat(data['observedAt']) == report['checked']


def test_absent_report_rows_do_not_become_zero(environment):
    config, google, db = environment
    with client_for(config, google, cloud=BillingCloud(), uony=Agent()) as client:
        ready(client, google, db); connect(db, config)
        seed_report(db, status='no_records')
        data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'unavailable' and data['consumptionEUR'] is None
        assert data['sync']['status'] == 'no_records'


def test_reports_never_cross_reconnected_identity_or_billing(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud, uony=Agent()) as client:
        ready(client, google, db); connect(db, config)
        seed_report(db, amount='9.99', connected=datetime.now(timezone.utc)-timedelta(days=1))
        data = client.get('/api/uony/google-billing').json()
        assert data['sync'] is None and data['consumptionEUR'] is None


def test_failed_current_billing_check_hides_automatic_money(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud, uony=Agent()) as client:
        ready(client, google, db); connect(db, config)
        seed_report(db, amount='9.99')
        cloud.metadata_error = 'permission_denied'
        data = client.get('/api/uony/google-billing').json()
        assert data['sync'] is None and data['consumptionEUR'] is None
        assert data['billingVerified'] is False
