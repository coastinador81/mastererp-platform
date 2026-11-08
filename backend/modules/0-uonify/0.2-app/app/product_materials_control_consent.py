"""Exact, versioned copy acknowledged before an additional paid analysis block."""
from hashlib import sha256
from fastapi import HTTPException


CONTROL_COPY = {
    'upgrade_readers': (
        'materials-upgrade-readers-2026-10-17-v1',
        'Uony puede ampliar la lectura de imágenes, documentos y archivos 3D de esta carpeta. Se conservan los datos confirmados; solo se analizan las partes nuevas. Esta ampliación dispone de un nuevo bloque de hasta 200 llamadas y 1.000.000 de tokens; al alcanzarlo se pausará. El consumo se realiza en tu proyecto de Google.\nAnalizar archivos pendientes con Uony',
    ),
    'repair_evidence': (
        'materials-repair-evidence-2026-10-17-v1',
        'Uony volverá a comprobar solo las partes con evidencia pendiente. Se conservan tus respuestas y el historial. Puede requerir nuevas llamadas de análisis en tu proyecto de Google, con consumo registrado y pausa al alcanzar el límite del bloque.\nResolver lectura pendiente con Uony',
    ),
}


def advertised_control_consent(action):
    version, content = CONTROL_COPY[action]
    return {'version': version, 'text': content,
            'sha256': sha256(content.encode('utf-8')).hexdigest()}


def control_consent(action, version, digest=None, content=None):
    """A new paid control requires the exact copy advertised to this client."""
    expected = advertised_control_consent(action)
    if version != expected['version'] or digest != expected['sha256'] or content != expected['text']:
        raise HTTPException(409, detail={
            'error': 'materials_consent_version',
            'message': 'No se ha iniciado otro análisis. Actualiza la página y revisa las condiciones de esta acción antes de continuar.',
        })
    return {'source': 'versioned_ui_ack', **expected}


def require_exact_control_replay(connection, user_id, request_id, version, digest, content):
    """Return an existing control only for its original decision, including pre-ledger controls."""
    receipt = connection.execute('''SELECT source,consent_version,consent_sha256,consent_text
        FROM product_material_control_authorizations
        WHERE user_id=%s AND request_id=%s''', (user_id, request_id)).fetchone()
    if receipt and receipt['source'] == 'versioned_ui_ack':
        exact = (version == receipt['consent_version'] and digest == receipt['consent_sha256']
                 and content == receipt['consent_text'])
    else:
        # Older requests did not carry a version. A retry can retrieve their result,
        # but must never turn that historical POST into an accepted new decision.
        exact = version is None and digest is None and content is None
    if not exact:
        raise HTTPException(409, detail={
            'error': 'materials_consent_replay_conflict',
            'message': 'Esta solicitud ya se registró con otras condiciones. Actualiza la página y consulta el estado del análisis antes de continuar.',
        })


def record_control_consent(connection, row, request_id, action, revision, consent):
    """Insert after the control, in the same transaction as the job update."""
    connection.execute('''INSERT INTO product_material_control_authorizations
        (user_id,request_id,job_id,action,google_subject,product_id,revision,
         folder_id,project_id,source,consent_version,consent_text,consent_sha256,accepted_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
               CASE WHEN %s='versioned_ui_ack' THEN now() ELSE NULL END)''',
        (row['user_id'], request_id, row['id'], action, row['google_subject'],
         row['product_id'], revision, row['folder_id'], row['project_id'],
         consent['source'], consent['version'], consent['text'], consent['sha256'],
         consent['source']))
