"""Read-only Google association and last verified monetary observation."""
from datetime import date, datetime, timedelta, timezone
import re
from urllib.parse import urlencode
from cryptography.fernet import Fernet
from fastapi import APIRouter, Request, HTTPException
from .access import workspace_access
from .google_account import require_same_connection
from .google_billing_observations import latest, money
from .google_billing_sync_store import cached_sync
from .google_cloud_provider import CloudError
from .onboarding import require_user

STALE_AFTER = timedelta(hours=24)


def console_links(account, email, project):
    if not isinstance(account, str) or not re.fullmatch(r'billingAccounts/[A-Za-z0-9-]+', account):
        return None
    root = 'https://console.cloud.google.com/billing/' + account.split('/', 1)[1]
    query = '?' + urlencode({'authuser': email, 'project': project})
    return {'credits': root + '/credits' + query, 'reports': root + '/reports' + query}


def unavailable_message(reason):
    return {
        'not_observed': 'Tu facturación está conectada. El crédito y el consumo no se sincronizan automáticamente con Uonify; puedes consultarlos en Google.',
        'google_required': 'Conecta Google Cloud y elige un proyecto para consultar tu facturación.',
        'reauthorize': 'La autorización de Google necesita renovarse. Revisa tu conexión antes de volver a consultar.',
        'permission_denied': 'Google no permite comprobar tu facturación con los permisos actuales. Puedes revisarla directamente en Google.',
        'billing_not_enabled': 'La facturación de este proyecto no está habilitada en Google.',
        'billing_not_linked': 'El proyecto no tiene una cuenta de facturación vinculada en Google.',
        'billing_account_closed': 'La cuenta de facturación vinculada está cerrada en Google.',
        'connection_changed': 'La conexión ha cambiado. Vuelve a consultar los datos de tu cuenta actual.',
    }.get(reason, 'No hemos podido comprobar tu facturación en Google. Puedes volver a intentarlo.')


def eligible(connection, request):
    user = require_user(connection, request)
    if not user.get('onboarding_completed_at') or workspace_access(connection, user)['status'] != 'allowed':
        raise HTTPException(403, detail={'error': 'access_required', 'message': 'Completa el alta y activa tu acceso a Uonify para consultar el consumo de Google.'})
    row = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user['id'],)).fetchone()
    if row:
        require_same_connection(user, row)
    return user, row


def empty(user, cloud, now, reason='not_observed'):
    return {'status': 'unavailable', 'accountEmail': user['email'],
            'projectId': cloud['project_id'] if cloud else None, 'projectName': cloud['project_name'] if cloud else None,
            'billingAccountName': None, 'currency': None, 'creditEUR': None, 'consumptionEUR': None,
            'netConsumptionEUR': None, 'consumptionScope': 'billing_account', 'periodStart': None, 'periodEnd': None,
            'observedAt': None, 'recordedAt': None, 'checkedAt': now.isoformat(), 'creditExpiresAt': None, 'creditExpiresOn': None,
            'source': None, 'reason': reason,
            'billingVerified': False, 'consoleLinks': None, 'message': unavailable_message(reason)}


def present(base, snapshot, now, error=None):
    if not snapshot:
        reason = error or base['reason']
        return {**base, 'reason': reason, 'message': unavailable_message(reason)}
    expired = bool(snapshot['credit_expires_at'] and snapshot['credit_expires_at'] <= now)
    expired = expired or bool(snapshot['credit_expires_on'] and snapshot['credit_expires_on'] <= now.astimezone(timezone.utc).date())
    expired = expired or any(e.get('expiresAt') and datetime.fromisoformat(e['expiresAt'].replace('Z', '+00:00')) <= now
                             for e in snapshot['credit_entries'])
    expired = expired or any(e.get('expiresOn') and date.fromisoformat(e['expiresOn']) <= now.astimezone(timezone.utc).date()
                             for e in snapshot['credit_entries'])
    old = now - snapshot['observed_at'] >= STALE_AFTER
    reason = error or ('credit_expired' if expired else 'observation_old' if old else None)
    stale = bool(reason)
    return {**base, 'status': 'stale' if stale else 'available', 'billingAccountName': snapshot['billing_account_name'],
            'currency': snapshot['currency'], 'creditEUR': None if expired else money(snapshot['credit_eur']),
            'consumptionEUR': money(snapshot['consumption_eur']), 'netConsumptionEUR': money(snapshot['net_consumption_eur']),
            'periodStart': snapshot['period_start'].isoformat() if snapshot['period_start'] else None,
            'periodEnd': snapshot['period_end'].isoformat() if snapshot['period_end'] else None,
            'observedAt': snapshot['observed_at'].isoformat(), 'recordedAt': snapshot['recorded_at'].isoformat(),
            'creditExpiresAt': snapshot['credit_expires_at'].isoformat() if snapshot['credit_expires_at'] else None,
            'creditExpiresOn': snapshot['credit_expires_on'].isoformat() if snapshot['credit_expires_on'] else None,
            'source': {'kind': snapshot['source_kind'], 'url': snapshot['source_url'], 'live': False}, 'reason': reason,
            'message': ('Mostramos la última observación verificada de Google. Necesita una nueva comprobación.' if stale else
                        'Importes observados en Google en la fecha indicada. El saldo no se actualiza automáticamente.')}


def same_selection(before, after):
    return bool(before and after and all(before[key] == after[key] for key in
                ('google_subject', 'project_id', 'connected_at', 'refresh_encrypted', 'status')))


def with_sync(base, sync):
    """Keep credit provenance separate from the automatically retrieved gross cost."""
    result = {**base, 'sync': sync}
    if not sync or not base['billingVerified'] or sync['status'] != 'ready':
        return result
    if base['creditEUR'] is not None:
        result.update(creditObservedAt=base['observedAt'], creditSource=base['source'],
                      creditStale=base['status'] == 'stale')
    return {**result, 'status': 'stale' if sync['canSync'] else 'available',
            'consumptionScope': 'project', 'currency': sync['currency'],
            'consumptionEUR': sync['consumptionEUR'], 'netConsumptionEUR': None,
            'periodStart': sync['periodStart'], 'periodEnd': sync['periodEnd'],
            'observedAt': sync['checkedAt'], 'recordedAt': sync['checkedAt'],
            'source': sync['source'], 'reason': 'report_old' if sync['canSync'] else None,
            'message': sync['message']}


def routes(settings, database, cloud):
    router = APIRouter()
    cipher = Fernet(settings.encryption_key)

    @router.get('/google-billing')
    def billing(request: Request):
        with database.connect() as connection:
            user, row = eligible(connection, request)
        now = datetime.now(timezone.utc)
        base = empty(user, row, now)
        if not row or not row['project_id']:
            return empty(user, row, now, 'google_required')
        account, error = None, None
        try:
            if row['status'] != 'connected':
                raise CloudError('reauthorize')
            token = cloud.refresh(cipher.decrypt(row['refresh_encrypted'].encode()).decode())
            info = cloud.billing_info(token, row['project_id'])
            account = info['name']
            metadata = cloud.billing_account(token, account)
            if not info['enabled']:
                error = 'billing_not_enabled'
            elif not metadata['open']:
                error = 'billing_account_closed'
        except CloudError as failure:
            error = failure.code
        with database.connect() as connection:
            current_user, current = eligible(connection, request)
            if current_user['id'] != user['id'] or not same_selection(row, current):
                return empty(current_user, current, datetime.now(timezone.utc), 'connection_changed')
            # Sin la asociación actual no sabemos si la cuenta de facturación
            # cambió. No rescatar importes de una cuenta anterior por proyecto.
            snapshot = latest(connection, current_user, current, account) if account else None
            sync = cached_sync(connection, current_user, current, account) if not error else None
        if account:
            base['billingAccountName'] = account
            base['consoleLinks'] = console_links(account, user['email'], row['project_id'])
            base['billingVerified'] = not error
        return with_sync(present(base, snapshot, datetime.now(timezone.utc), error), sync)
    return router
