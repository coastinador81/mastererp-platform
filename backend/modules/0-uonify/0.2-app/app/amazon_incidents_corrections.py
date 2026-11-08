"""Corrección revisada, envío único y conciliación posterior; ningún guardado cierra una incidencia."""
import json
import re
from uuid import uuid4
from psycopg.types.json import Jsonb
from .amazon_catalog import AmazonReadError
from .amazon_listings_provider import AmazonSubmissionUnknown
from .amazon_store import fail
from . import amazon_incidents_store as store


def validate_patch(context, changes, validator):
    if (not isinstance(changes, dict) or not changes or len(changes) > 30
            or len(json.dumps(changes, ensure_ascii=False)) > 60000):
        fail('invalid_correction', 'Revisa los atributos que quieres corregir.')
    properties = context['schema'].get('properties', {})
    for name, values in changes.items():
        if (not re.fullmatch(r'[a-z][a-z0-9_]{0,150}', name) or name not in properties
                or properties[name].get('editable') is False or properties[name].get('hidden') is True
                or not isinstance(values, list) or not values or any(not isinstance(v, dict) for v in values)):
            fail('invalid_correction_attribute', 'Este atributo no admite esa corrección en Amazon.')
        market = context['incident']['marketplaceId']
        previous = context['attributes'].get(name, [])
        foreign = [x for x in previous if x.get('marketplace_id') not in (None, market)]
        if any(x not in values for x in foreign):
            fail('other_marketplace_changed', 'La corrección debe conservar los valores de los otros mercados.')
        if any(x.get('marketplace_id') not in (None, market) and x not in foreign for x in values):
            fail('other_marketplace_changed', 'Esta corrección solo está autorizada para el mercado seleccionado.')
    validator(context['schema'], {**context['attributes'], **changes}, set(changes))


def protect_pending(c, row, attributes):
    pending = c.execute('''SELECT attributes FROM amazon_incident_submissions WHERE user_id=%s
        AND seller_id=%s AND marketplace_id=%s AND sku=%s AND status IN ('sending','accepted','unknown')''',
        (row['user_id'], row['seller_id'], row['marketplace_id'], row['sku'])).fetchall()
    if any(set(x['attributes']) & set(attributes) for x in pending):
        fail('attribute_submission_pending', 'Amazon aún debe confirmar un envío de estos atributos. Comprueba ese resultado antes de enviar otra corrección.', 409)


def prepare(service, user_id, incident_id, revision, attributes, request_id, validator):
    data = {'revision': revision, 'attributes': attributes}
    try:
        with service.database.connect() as c:
            row = store.get(c, user_id, incident_id)
            store.lock_account(c, user_id, row['seller_id'], row['marketplace_id'])
            old, digest = store.replay(c, user_id, request_id, 'prepare', incident_id, data)
            if old:
                return old['result'] or service.get(user_id, incident_id)
            row, context, _, snap = service._fresh_context(c, user_id, incident_id)
            if row['revision'] != revision:
                fail('incident_conflict', 'La incidencia ha cambiado. Revisa el estado actual antes de preparar la corrección.', 409)
            if row['status'] not in ('needs_attention', 'correction_ready'):
                fail('incident_not_editable', 'Espera el resultado de Amazon o revisa el estado de esta incidencia.', 409)
            validate_patch(context, attributes, validator)
            protect_pending(c, row, attributes)
            if all(context['attributes'].get(k) == v for k, v in attributes.items()):
                fail('unchanged_correction', 'Los datos son iguales a los que ya tiene Amazon. Revisa otra corrección.')
            correction = {'attributes': attributes, 'preparedAt': store.iso(store.now()),
                          'schemaHash': context['schemaHash'], 'productType': context['productType'],
                          'baseline': {k: context['attributes'].get(k) for k in attributes},
                          'snapshotVersion': snap['version']}
            row = c.execute('''UPDATE amazon_incidents SET correction=%s,status='correction_ready',
                revision=revision+1,submission_status=NULL,submission_issues='[]',history=%s WHERE id=%s RETURNING *''',
                (Jsonb(correction), Jsonb(store.history(row, 'prepared', 'Corrección preparada. Aún no se ha enviado a Amazon.')),
                 row['id'])).fetchone()
            result = store.detail(row)
            c.execute('''INSERT INTO amazon_incident_requests(user_id,request_id,incident_id,operation,fingerprint,result)
                VALUES(%s,%s,%s,'prepare',%s,%s)''', (user_id, request_id, row['id'], digest, Jsonb(result)))
            return result
    except AmazonReadError:
        fail('amazon_unavailable', 'No se pudo comprobar el estado y los requisitos actuales de Amazon. Tu respuesta se conserva.', 503)


def submit(service, user_id, incident_id, revision, request_id, validator):
    data = {'revision': revision}
    try:
        with service.database.connect() as c:
            row = store.get(c, user_id, incident_id)
            store.lock_account(c, user_id, row['seller_id'], row['marketplace_id'])
            old, digest = store.replay(c, user_id, request_id, 'submit', incident_id, data)
            if old:
                return old['result'] or store.detail(store.get(c, user_id, incident_id))
            row, context, client, snap = service._fresh_context(c, user_id, incident_id)
            if row['revision'] != revision or row['status'] != 'correction_ready' or not row['correction']:
                fail('incident_conflict', 'Revisa y aprueba la corrección actual antes de enviarla.', 409)
            correction = row['correction']
            if context['schemaHash'] != correction['schemaHash'] or context['productType'] != correction['productType']:
                fail('amazon_schema_changed', 'Amazon ha actualizado los requisitos. Revisa la corrección antes de enviarla.', 409)
            if any(context['attributes'].get(k) != v for k, v in correction['baseline'].items()):
                fail('amazon_listing_changed', 'Estos atributos cambiaron en Amazon. Revisa los valores actuales antes de enviarlos.', 409)
            validate_patch(context, correction['attributes'], validator)
            protect_pending(c, row, correction['attributes'])
            sent, submission_id = store.now(), uuid4()
            c.execute('''INSERT INTO amazon_incident_submissions
                (id,incident_id,user_id,seller_id,marketplace_id,sku,request_id,attributes,schema_hash,baseline_updated_at,sent_at,status)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'sending')''',
                (submission_id, row['id'], user_id, row['seller_id'], row['marketplace_id'], row['sku'], request_id,
                 Jsonb(correction['attributes']), correction['schemaHash'], snap['upstream_updated_at'], sent))
            c.execute('''UPDATE amazon_incidents SET status='awaiting_amazon',submission_status='unknown',revision=revision+1,
                history=%s WHERE id=%s''',
                (Jsonb(store.history(row, 'sending', 'Envío iniciado. El resultado necesita confirmación de Amazon.')), row['id']))
            c.execute('''INSERT INTO amazon_incident_requests(user_id,request_id,incident_id,operation,fingerprint)
                VALUES(%s,%s,%s,'submit',%s)''', (user_id, request_id, row['id'], digest))
        # The durable sending marker exists BEFORE the external side effect. A retry can never resend it.
        result = client.patch(row['seller_id'], row['marketplace_id'], row['sku'],
                              correction['productType'], correction['attributes'])
        outcome = 'accepted' if result['status'] == 'ACCEPTED' else 'rejected'
    except AmazonSubmissionUnknown:
        result, outcome = {}, 'unknown'
    except AmazonReadError:
        if 'submission_id' not in locals():
            fail('amazon_unavailable', 'No podemos comprobar Amazon para enviar esta corrección. No se ha enviado.', 503)
        result, outcome = {}, 'rejected'
    return finish_submission(service, user_id, incident_id, request_id, submission_id, outcome, result)


def finish_submission(service, user_id, incident_id, request_id, submission_id, outcome, response):
    messages = {'accepted': 'Amazon aceptó el envío. Esperamos comprobar la aplicación y las incidencias posteriores.',
                'unknown': 'No se pudo confirmar la respuesta al envío. No lo repetiremos automáticamente; comprueba el estado.',
                'rejected': 'Amazon no aceptó esta corrección. Revisa la respuesta antes de volver a preparar los datos.'}
    issues = response.get('issues', [])
    diagnostic = ' '.join(x.get('message', '') for x in issues if isinstance(x, dict))[:4000]
    message = messages[outcome] + (' ' + diagnostic if diagnostic else '')
    with service.database.connect() as c:
        # Account can disconnect while a request is in flight: retain its receipt without exposing it to another seller.
        row = c.execute('SELECT * FROM amazon_incidents WHERE user_id=%s AND id=%s',
                        (user_id, incident_id)).fetchone()
        store.lock_account(c, user_id, row['seller_id'], row['marketplace_id'])
        row = c.execute('SELECT * FROM amazon_incidents WHERE user_id=%s AND id=%s FOR UPDATE',
                        (user_id, incident_id)).fetchone()
        submission = c.execute('SELECT * FROM amazon_incident_submissions WHERE id=%s FOR UPDATE', (submission_id,)).fetchone()
        reconciled = submission['status'] in ('confirmed', 'needs_attention')
        c.execute('''UPDATE amazon_incident_submissions SET status=%s,response=%s,submission_id=%s,request_receipt=%s
            WHERE id=%s''',
            (submission['status'] if reconciled else outcome, Jsonb(response), response.get('submissionId'),
             response.get('requestReceipt'), submission_id))
        # A concurrent proven application may have reconciled even before this receipt arrived.
        row = c.execute('''UPDATE amazon_incidents SET status=%s,submission_status=%s,submission_issues=%s,revision=revision+1,history=%s
            WHERE id=%s RETURNING *''',
            (row['status'] if reconciled else 'needs_attention' if outcome == 'rejected' else 'awaiting_amazon', outcome,
             Jsonb(issues), Jsonb(store.history(row, outcome, message)), incident_id)).fetchone()
        if issues:
            snap = c.execute('''SELECT * FROM amazon_listing_snapshots WHERE user_id=%s AND seller_id=%s
                AND marketplace_id=%s AND sku=%s''',
                (user_id, row['seller_id'], row['marketplace_id'], row['sku'])).fetchone()
            if snap:
                snap = {**snap, 'data': {**snap['data'], 'issues': issues}, 'fetched_at': store.now()}
                store.observe(c, user_id, row['seller_id'], row['marketplace_id'], snap, reconcile=False)
                row = c.execute('SELECT * FROM amazon_incidents WHERE id=%s', (incident_id,)).fetchone()
        dto = store.detail(row)
        c.execute('UPDATE amazon_incident_requests SET result=%s WHERE user_id=%s AND request_id=%s',
                  (Jsonb(dto), user_id, request_id))
        return dto
