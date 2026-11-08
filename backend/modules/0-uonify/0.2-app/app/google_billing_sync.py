"""Durable automatic Google cost consultation. Never generates AI or estimates credit."""
from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4
from cryptography.fernet import Fernet
from fastapi import HTTPException
from .access import workspace_access
from .google_account import require_same_connection
from .google_billing_reports import GoogleBillingReports, month_period
from .google_billing_sync_store import begin, save, public_sync, MESSAGES
from .google_cloud_provider import CloudError

SERVICE = 'appoptimize.googleapis.com'


def failure(code, status=409):
    return HTTPException(status, detail={'error': code, 'message': MESSAGES.get(code, 'No hemos podido consultar el consumo de Google. Tu trabajo se conserva.')})


class GoogleBillingSync:
    def __init__(self, settings, database, cloud, reports=None):
        self.database, self.cloud = database, cloud
        self.cipher = Fernet(settings.encryption_key)
        self.reports = reports if reports is not None else GoogleBillingReports()

    def _context(self, connection, user_id, guards=None):
        user = connection.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
        if not user or user.get('deletion_requested_at'):
            raise failure('connection_changed')
        if guards:
            guards(connection, user)
        if not user.get('onboarding_completed_at') or workspace_access(connection, user)['status'] != 'allowed':
            raise failure('access_required', 403)
        cloud = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user_id,)).fetchone()
        if not cloud or cloud['status'] != 'connected' or not cloud.get('project_id'):
            raise failure('reauthorize')
        require_same_connection(user, cloud)
        connection.commit()
        return user, cloud

    def _guard(self, connection, row, guards=None):
        user, cloud = self._context(connection, row['user_id'], guards)
        if any(cloud.get(key) != row.get(key) for key in ('google_subject', 'project_id', 'connected_at')):
            raise failure('connection_changed')
        return user, cloud

    def _billing(self, connection, token, user_id, snapshot, guards=None, account=None):
        _, current = self._context(connection, user_id, guards)
        if any(current.get(key) != snapshot.get(key) for key in ('google_subject','project_id','connected_at')):
            raise failure('connection_changed')
        info = self.cloud.billing_info(token, current['project_id'])
        _, after = self._context(connection, user_id, guards)
        if any(after.get(key) != current.get(key) for key in ('google_subject','project_id','connected_at')):
            raise failure('connection_changed')
        name = info.get('name')
        if not isinstance(name, str) or not re.fullmatch(r'billingAccounts/[A-Za-z0-9-]+', name):
            raise CloudError('billing_not_linked')
        if account and account != name:
            raise failure('connection_changed')
        if info.get('enabled') is not True:
            raise CloudError('billing_not_enabled')
        return name

    def _io(self, connection, row, token, call, guards=None):
        _, cloud = self._guard(connection, row, guards)
        self._billing(connection, token, row['user_id'], cloud, guards, row['billing_account_name'])
        try:
            value = call()
        finally:
            # A late response must never publish data after disconnection,
            # account deletion, permission revocation or project/billing change.
            self._guard(connection, row, guards)
            self._billing(connection, token, row['user_id'], cloud, guards, row['billing_account_name'])
        return value

    def _wait(self, connection, row, reason=None, delay=None):
        now = datetime.now(timezone.utc)
        attempt = row['attempts'] + 1
        delay = delay or min(30, 5 * (2 ** min(attempt - 1, 3)))
        stopped = attempt >= 20
        save(connection, row, status='error' if stopped else 'pending', checked_at=now, attempts=attempt,
             next_check_at=now + timedelta(seconds=60 if stopped else delay),
             error_code='google_processing_delayed' if stopped else reason)
        return public_sync(row, now)

    def _service(self, connection, row, token, prepare, guards):
        if prepare and not row['prepared_at']:
            save(connection, row, prepared_at=datetime.now(timezone.utc))
        if not row['project_resource']:
            data = self._io(connection, row, token, lambda: self.cloud.request(token, 'GET',
                'https://cloudresourcemanager.googleapis.com/v3/projects/' + row['project_id']), guards)
            if (data.get('projectId') != row['project_id'] or data.get('state') != 'ACTIVE' or
                    not re.fullmatch(r'projects/\d+', data.get('name', ''))):
                raise CloudError('invalid_response')
            save(connection, row, project_resource=data['name'])
        url = 'https://serviceusage.googleapis.com/v1/' + row['project_resource'] + '/services/' + SERVICE
        data = self._io(connection, row, token, lambda: self.cloud.request(token, 'GET', url), guards)
        if data.get('state') == 'ENABLED':
            save(connection, row, service_state='enabled', service_operation=None)
            return True
        if data.get('state') != 'DISABLED':
            raise CloudError('invalid_response')
        if row['service_state'] == 'enabling' and row.get('service_operation'):
            operation = self._io(connection, row, token, lambda: self.cloud.request(token, 'GET',
                'https://serviceusage.googleapis.com/v1/' + row['service_operation']), guards)
            if operation.get('error'):
                raise CloudError('permission_denied')
            if operation.get('done') is not True:
                return False
        if not row['prepared_at']:
            save(connection, row, status='needs_setup', error_code='service_disabled', checked_at=datetime.now(timezone.utc), next_check_at=None)
            return False
        if row['service_state'] == 'enabling':
            elapsed = datetime.now(timezone.utc) - (row['service_started_at'] or row['created_at'])
            if elapsed < timedelta(minutes=2):
                return False
            if not (prepare and row.get('error_code') == 'service_unconfirmed'):
                raise CloudError('service_unconfirmed')
            # A new explicit preparation request follows a fresh DISABLED read.
            # Never repeat an uncertain enable automatically.
        save(connection, row, service_state='enabling', service_started_at=datetime.now(timezone.utc), status='pending', error_code=None)
        try:
            operation = self._io(connection, row, token, lambda: self.cloud.request(token, 'POST', url + ':enable', {}), guards)
        except CloudError as error:
            if error.code in ('permission_denied','reauthorize','quota_exceeded'):
                save(connection, row, service_state='unchecked')
            raise
        name = operation.get('name')
        if not isinstance(name, str) or not re.fullmatch(r'operations/[A-Za-z0-9_.-]{1,300}', name):
            raise CloudError('invalid_response')
        save(connection, row, service_operation=name)
        return False

    def _report(self, connection, row, token, guards):
        args = (token, row['project_id'], row['report_id'], row['period_start'], row['period_end'])
        if row['report_state'] in ('creating', 'uncertain', 'ready'):
            try:
                result = self._io(connection, row, token, lambda: self.reports.metadata(*args), guards)
            except CloudError as error:
                if error.code == 'not_found':
                    elapsed = datetime.now(timezone.utc) - (row['report_started_at'] or row['created_at'])
                    if elapsed >= timedelta(hours=24):
                        raise CloudError('report_expired') from None
                    if elapsed >= timedelta(minutes=2):
                        if row['create_attempts'] >= 2:
                            raise CloudError('report_unconfirmed')
                        # Google confirms this name is absent. Reuse the same
                        # server-enforced report ID for one bounded retry.
                        save(connection, row, report_state='reserved')
                    return self._wait(connection, row, 'report_unconfirmed', 30)
                raise
        elif row['report_state'] == 'pending' and row['report_operation']:
            try:
                result = self._io(connection, row, token, lambda: self.reports.poll(token, row['project_id'],
                    row['report_operation'], row['report_id'], row['period_start'], row['period_end']), guards)
            except CloudError as error:
                if error.code != 'not_found':
                    raise
                try:
                    result = self._io(connection, row, token, lambda: self.reports.metadata(*args), guards)
                except CloudError as missing:
                    if missing.code == 'not_found':
                        age = datetime.now(timezone.utc) - (row['report_started_at'] or row['created_at'])
                        raise CloudError('report_expired' if age >= timedelta(hours=24) else 'report_unconfirmed') from None
                    raise
        else:
            # Record intent and ID before network IO. On a crash or timeout the
            # next request reconciles this exact ID instead of creating another.
            save(connection, row, report_state='creating', report_started_at=datetime.now(timezone.utc),
                 create_attempts=row['create_attempts']+1)
            try:
                result = self._io(connection, row, token, lambda: self.reports.create(*args), guards)
            except CloudError as error:
                state = 'uncertain' if error.code in ('google_unavailable','invalid_response','already_exists') else 'reserved'
                save(connection, row, report_state=state)
                if state == 'uncertain':
                    return self._wait(connection, row, 'report_unconfirmed', 30)
                raise
        if result.get('status') == 'pending':
            save(connection, row, report_state='pending', report_operation=result.get('operationName', row.get('report_operation')))
            return self._wait(connection, row)
        if result.get('status') != 'ready':
            raise CloudError('invalid_response')
        save(connection, row, report_state='ready', report_operation=result.get('operationName', row.get('report_operation')))
        data = self._io(connection, row, token, lambda: self.reports.read(token, row['project_id'], row['report_id']), guards)
        now = datetime.now(timezone.utc)
        if data.get('status') == 'no_records':
            save(connection, row, status='no_records', consumption_eur=None, currency=None, checked_at=now,
                 next_check_at=now + timedelta(hours=1), error_code=None)
        elif data.get('status') == 'available' and data.get('currency') == 'EUR' and isinstance(data.get('consumptionEUR'), str):
            save(connection, row, status='ready', consumption_eur=data['consumptionEUR'], currency='EUR', checked_at=now,
                 next_check_at=now + timedelta(hours=6), error_code=None)
        else:
            raise CloudError('invalid_response')
        return public_sync(row, now)

    def sync(self, user_id, prepare=False, request_guards=None):
        with self.database.connect() as connection:
            locked = connection.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,710152026)) AS locked',
                (str(user_id),)).fetchone()['locked']
            if not locked:
                raise failure('billing_sync_busy')
            row = None
            try:
                user, cloud = self._context(connection, user_id, request_guards)
                token = self.cloud.refresh(self.cipher.decrypt(cloud['refresh_encrypted'].encode()).decode())
                current_user, current = self._context(connection, user_id, request_guards)
                if any(current.get(key) != cloud.get(key) for key in ('google_subject','project_id','connected_at','refresh_encrypted')):
                    raise failure('connection_changed')
                account = self._billing(connection, token, user_id, cloud, request_guards)
                row = begin(connection, current_user, current, account)
                now = datetime.now(timezone.utc)
                if row.get('lease_until') and row['lease_until'] > now:
                    return public_sync(row, now)
                if row.get('next_check_at') and row['next_check_at'] > now and not (prepare and (row['status'] == 'needs_setup' or row.get('error_code') == 'service_unconfirmed')):
                    return public_sync(row, now)
                metadata = self._io(connection, row, token, lambda: self.cloud.billing_account(token, account), request_guards)
                if metadata.get('open') is not True:
                    raise CloudError('billing_account_closed')
                if row['status'] in ('ready','no_records') or row.get('error_code') == 'report_expired':
                    start, end = month_period(now)
                    save(connection, row, status='pending', report_state='reserved', report_id='uonify-'+uuid4().hex,
                         report_operation=None, period_start=start, period_end=end, consumption_eur=None, currency=None,
                         attempts=0, create_attempts=0, report_started_at=None, error_code=None)
                save(connection, row, lease_until=now+timedelta(seconds=120))
                if not self._service(connection, row, token, prepare, request_guards):
                    return public_sync(row) if row['status'] == 'needs_setup' else self._wait(connection, row)
                return self._report(connection, row, token, request_guards)
            except CloudError as error:
                if not row:
                    raise failure(error.code, 503) from None
                now = datetime.now(timezone.utc)
                status = 'needs_setup' if error.code == 'service_disabled' else 'error'
                save(connection, row, status=status, error_code=error.code, checked_at=now,
                     next_check_at=None if status == 'needs_setup' else now+timedelta(seconds=getattr(error,'retry_after',None) or 60),
                     consumption_eur=None, currency=None)
                return public_sync(row, now)
            except HTTPException:
                if row:
                    save(connection, row, status='error', error_code='connection_changed', consumption_eur=None, currency=None)
                raise
            finally:
                if connection.info.transaction_status.name == 'INERROR':
                    connection.rollback()
                if row:
                    connection.execute('UPDATE google_billing_sync SET lease_until=NULL WHERE id=%s', (row['id'],))
                connection.execute('SELECT pg_advisory_unlock(hashtextextended(%s,710152026))', (str(user_id),))
