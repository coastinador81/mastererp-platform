"""Versioned, server-owned text for the decision to start Drive analysis."""
from hashlib import sha256
from fastapi import HTTPException


MATERIAL_START_CONSENT_VERSION = 'materials-start-2026-10-17-v1'
MATERIAL_START_CONSENT_LINES = (
    'Carpeta con los materiales del producto',
    'Uony analizará los documentos y las imágenes de esta carpeta y sus subcarpetas. Tus originales se conservan.',
    'Presupuesto inicial: 200 llamadas y 1.000.000 de tokens. Al alcanzar el límite, el análisis se pausa automáticamente. El consumo se realiza en tu proyecto de Google conectado.',
    'Analizar carpeta con Uony',
)
MATERIAL_START_CONSENT_TEXT = '\n'.join(MATERIAL_START_CONSENT_LINES)
MATERIAL_START_CONSENT_SHA256 = sha256(MATERIAL_START_CONSENT_TEXT.encode('utf-8')).hexdigest()


def start_consent(version, digest=None, text=None, *, require_version=True):
    """A new paid analysis requires the server-owned copy, including internal callers."""
    if not require_version:
        raise ValueError('Unversioned material analysis is no longer admitted')
    # Both the text the client checked and its digest must match this process.
    # A mixed deployment can otherwise serve the GET on copy A and POST on B.
    if (version != MATERIAL_START_CONSENT_VERSION or text != MATERIAL_START_CONSENT_TEXT
            or digest != MATERIAL_START_CONSENT_SHA256):
        raise HTTPException(409, detail={
            'error': 'materials_consent_version',
            'message': 'No se ha iniciado otro análisis. Actualiza la página y revisa las condiciones antes de continuar.',
        })
    return {'source': 'versioned_ui_ack', 'version': version,
            'text': MATERIAL_START_CONSENT_TEXT, 'sha256': MATERIAL_START_CONSENT_SHA256}


def require_exact_start_replay(connection, user_id, job_id, version, digest, text):
    """A recorded start can be read again, never rewritten as a different decision."""
    receipt = connection.execute('''SELECT source,consent_version,consent_sha256,consent_text
        FROM product_material_job_authorizations
        WHERE user_id=%s AND job_id=%s''', (user_id, job_id)).fetchone()
    if receipt and receipt['source'] == 'versioned_ui_ack':
        exact = (version == receipt['consent_version'] and digest == receipt['consent_sha256']
                 and text == receipt['consent_text'])
    else:
        # Jobs created before the ledger (or by the former POST) have no
        # versioned acceptance. Their original no-copy request can be replayed.
        exact = version is None and digest is None and text is None
    if not exact:
        raise HTTPException(409, detail={
            'error': 'materials_consent_replay_conflict',
            'message': 'Esta solicitud ya se registró con otras condiciones. Actualiza la página y consulta el análisis guardado antes de continuar.',
        })


def record_start_consent(connection, row, consent, reanalysis_of, *, assignment_id=None):
    """Call only after a fresh job INSERT, within that same transaction."""
    connection.execute('''INSERT INTO product_material_job_authorizations
        (user_id,job_id,origin_request_id,google_subject,product_id,revision,
         folder_id,project_id,assignment_id,reanalysis_of,action,source,
         consent_version,consent_text,consent_sha256,accepted_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
               CASE WHEN %s='versioned_ui_ack' THEN now() ELSE NULL END)''',
        (row['user_id'], row['id'], row['request_id'], row['google_subject'],
         row['product_id'], row['revision'], row['folder_id'], row['project_id'],
         assignment_id, reanalysis_of, 'reanalysis' if reanalysis_of else 'start',
         consent['source'], consent['version'], consent['text'], consent['sha256'],
         consent['source']))
