"""Private, identity-bound journal and safe public state for Google cost reports."""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from .google_billing_reports import DOCS_URL, LATENCY_MESSAGE, month_period

MESSAGES = {
    'google_processing_delayed': 'Google sigue preparando esta consulta. Puedes volver a revisar el mismo informe más adelante; no crearemos otro por este retraso.',
    'period_not_ready': 'El nuevo periodo de Google acaba de empezar. Vuelve a consultarlo en unos segundos.',
    'service_disabled': 'Activa la consulta de consumo para que Uonify pueda leer los costes que publica Google.',
    'permission_denied': 'Google no permite consultar estos costes con los permisos actuales. Tu proyecto y el resto de Uonify siguen disponibles.',
    'reauthorize': 'Renueva la conexión de Google para continuar consultando el consumo.',
    'billing_not_enabled': 'La facturación del proyecto no está habilitada en Google.',
    'billing_account_closed': 'La cuenta de facturación del proyecto está cerrada en Google.',
    'connection_changed': 'La conexión o la facturación ha cambiado. Conservamos el informe anterior sin mostrar sus importes.',
    'quota_exceeded': 'Google ha limitado temporalmente esta consulta. Puedes volver a consultarla más adelante.',
    'unsupported_currency': 'Google ha devuelto una moneda distinta del euro. No convertimos ni presentamos ese importe como euros.',
    'report_unconfirmed': 'Google aún no confirma el informe solicitado. Conservamos la misma consulta para evitar crear otra.',
    'service_unconfirmed': 'Google no ha confirmado la activación de la consulta. Puedes autorizar de nuevo esa activación; no genera contenido ni realiza un cobro.',
    'report_expired': 'El informe de Google ha caducado. Una nueva consulta obtendrá los costes actualizados.',
}


def public_sync(row, now=None):
    if not row:
        return None
    now = now or datetime.now(timezone.utc)
    status = row['status']
    reason = row.get('error_code')
    message = ('Consumo del proyecto conectado, antes de aplicar créditos. ' + LATENCY_MESSAGE if status == 'ready' else
               'Google todavía no ha publicado registros para este periodo. No significa que el consumo sea cero.' if status == 'no_records' else
               MESSAGES.get(reason, 'Google está preparando la consulta de consumo.' if status == 'pending' else 'No hemos podido consultar el consumo. Tu trabajo se conserva.'))
    ready = status == 'ready'
    return {'status': status, 'projectId': row['project_id'], 'billingAccountName': row['billing_account_name'], 'canSync': not row.get('next_check_at') or row['next_check_at'] <= now,
            'nextCheckAt': row['next_check_at'].isoformat() if row.get('next_check_at') else None,
            'checkedAt': row['checked_at'].isoformat() if row.get('checked_at') else None,
            'periodStart': row['period_start'].isoformat(), 'periodEnd': row['period_end'].isoformat(),
            'consumptionEUR': format(Decimal(row['consumption_eur']), '.2f') if ready else None,
            'currency': 'EUR' if ready else None, 'reason': reason, 'message': message,
            'source': {'kind': 'google_app_optimize', 'url': DOCS_URL, 'live': True,
                       'scope': 'project', 'costBasis': 'gross_before_credits'} if ready or status == 'no_records' else None}


def cached_sync(connection, user, cloud, account, now=None):
    if (not cloud or cloud.get('status') != 'connected' or user.get('deletion_requested_at') or
            user.get('google_subject') != cloud.get('google_subject') or not account):
        return None
    row = connection.execute('''SELECT * FROM google_billing_sync WHERE user_id=%s AND google_subject=%s
        AND project_id=%s AND billing_account_name=%s AND connected_at=%s''',
        (user['id'], user['google_subject'], cloud['project_id'], account, cloud['connected_at'])).fetchone()
    return public_sync(row, now)


def save(connection, row, **changes):
    allowed = {'status','service_state','service_operation','report_state','report_id','report_operation','period_start',
               'period_end','prepared_at','checked_at','next_check_at','consumption_eur','currency','error_code','attempts',
               'lease_until','project_resource','report_started_at','service_started_at','create_attempts'}
    if not changes or not set(changes) <= allowed:
        raise ValueError('Unsupported journal fields')
    fields = ','.join(key+'=%s' for key in changes)
    current = connection.execute('UPDATE google_billing_sync SET '+fields+',updated_at=now() WHERE id=%s RETURNING *',
        (*changes.values(), row['id'])).fetchone()
    connection.commit()
    if current:
        row.update(current)
    return current


def begin(connection, user, cloud, account):
    start, end = month_period()
    row = connection.execute('''SELECT * FROM google_billing_sync WHERE user_id=%s AND google_subject=%s
        AND project_id=%s AND billing_account_name=%s AND connected_at=%s''',
        (user['id'],user['google_subject'],cloud['project_id'],account,cloud['connected_at'])).fetchone()
    if row:
        return row
    identifier = uuid4()
    row = connection.execute('''INSERT INTO google_billing_sync(id,user_id,google_subject,project_id,billing_account_name,
        connected_at,status,report_id,period_start,period_end) VALUES(%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s) RETURNING *''',
        (identifier,user['id'],user['google_subject'],cloud['project_id'],account,cloud['connected_at'],
         'uonify-'+uuid4().hex,start,end)).fetchone()
    connection.commit()
    return row
