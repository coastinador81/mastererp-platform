"""Estudio ADK · Gate 1 (condición 1 del veredicto 20261022-VEREDICTO-HERRAMIENTAS-UONY-ESTUDIO-ADK):
GASTO a prueba de modelo, sobre UNA pieza (§6).

El modelo solo PROPONE: `cotizar_estudio` emite la cotización (§6 issue_complete_quote) y un TOKEN de
confirmación de un solo uso. El token se entrega SOLO a la UI del cliente (campo `clientConfirmation`),
NUNCA al modelo (campo `model`): el runtime del agente debe dar `clientConfirmation` a la UI y devolver
al modelo únicamente `model`. El OK que GASTA es `confirmar_creacion`, una RUTA DEL CLIENTE (no una
herramienta del modelo): exige el token (que solo la UI tiene, de la tarjeta que el cliente vio) + la
cotización sellada vigente, y entonces aprueba el §6 (approve_exact) con `acknowledged=True` puesto por
el SERVIDOR. El modelo no tiene el token ni herramienta de gasto, así que no puede fabricar el OK; y la
secuencia la impone el backend (confirmar exige una cotización vigente de cotizar). Idempotente.
"""
from datetime import datetime, timedelta, timezone
from enum import Enum
from hashlib import sha256
import logging
from secrets import token_urlsafe
from uuid import NAMESPACE_URL, uuid5

from .creative_google_capabilities import model_label
from .creative_generation_ledger import (_active_user, _quote_current,
                                         approve_exact, get_approval,
                                         issue_complete_quote)
from .creative_price_display import eur_display_max
from .products import fail

logger = logging.getLogger(__name__)

# C5 (veredicto «sí escrito»): el token de confirmación tiene un TTL FINITO forzado en servidor. La
# DURACIÓN exacta (cuánto sigue accionable la tarjeta) es UX del dueño (D-UX-OWNER-DEFINES); aquí un valor
# por defecto prudente. Pasado el TTL, aceptar exige re-cotizar (token nuevo).
_CONFIRMATION_TTL = timedelta(minutes=15)


class AcceptanceSignal(str, Enum):
    """C2: señal de interpretación TIPADA que el modelo produce para el «sí» escrito. El servidor confirma
    SOLO con ACEPTA (aceptación inequívoca de ESTE gasto); DUDOSO→Uony pregunta; NO_ACEPTA→no gasta. Es el
    ÚNICO filtro semántico (sin listas de palabras en servidor → respeta la fluidez que decidió el dueño)."""
    ACEPTA = 'ACEPTA'
    NO_ACEPTA = 'NO_ACEPTA'
    DUDOSO = 'DUDOSO'


# Mapa estado del intento §6 → estado de la tarjeta de avance (los TEXTOS salen de las maquetas).
_ESTADO = {'reserved': 'creandose', 'succeeded': 'lista',
           'failed': 'fallida', 'unknown': 'incierta'}


def _card_safe_quote(quote, max_eur):
    """D-PROTECCION-INGENIERIA-INVERSA (regla 1): SOLO lo que pinta la tarjeta. NUNCA el id de modelo
    crudo, el USD interno, los hashes (quote/plan/request sha), el project id de Google ni el desglose
    de precio. El precio visible es el € aproximado; el motor es el nombre PEQUEÑO de Google (etiqueta
    del catálogo), nunca el id. Los textos/nombre llano los pone la tarjeta (owner-UX)."""
    return {'quoteId': quote['quoteId'], 'operation': quote['operation'],
            'googleName': model_label(quote['model']), 'maxEur': max_eur,
            'payer': 'customer_google_project'}


def _card_safe_approval(approval):
    """Regla 1: la confirmación devuelve solo el handle y el estado; nada de USD/hashes/actor/request."""
    return {'approvalId': approval['approvalId'], 'generationStarted': approval['generationStarted']}


def _issue_confirmation(c, user, quote):
    """Emite (o reusa, idempotente) el token de confirmación de la cotización. Un token por quote."""
    token = token_urlsafe(32)   # 43 chars base64url → casa [A-Za-z0-9_-]{32,64}
    row = c.execute('''INSERT INTO creative_estudio_confirmations
        (user_id, quote_id, token, quote_sha256, max_total_usd, thread_id)
        VALUES(%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id, quote_id) DO NOTHING RETURNING token''',
        (user['id'], quote['quoteId'], token, quote['quoteSha256'],
         quote['maxTotalUsd'], quote['threadId'])).fetchone()
    if not row:
        row = c.execute('''SELECT token FROM creative_estudio_confirmations
            WHERE user_id=%s AND quote_id=%s''', (user['id'], quote['quoteId'])).fetchone()
    return row['token']


def cotizar_estudio(c, user, plan_id, issue_request_id, request, cost, *, fx_usd_to_eur=None):
    """Herramienta del MODELO: propone la cotización de UNA pieza (§6) y emite el token de confirmación.
    NO gasta. Devuelve DOS partes CARD-SAFE (regla 1): `card` (lo que ve el modelo y pinta la tarjeta —
    sin USD/hashes/id-de-modelo/project-id) y `clientConfirmation` (SOLO para la UI: el token + el
    quoteId). El USD interno NO sale: se usa aquí mismo para calcular el € (§F) y se queda en el servidor.
    `fx_usd_to_eur` lo da el servidor (fuente BCE); sin él, maxEur=None y el €-display se calcula al
    cablear la fuente. El runtime del agente debe dar al modelo solo `card` y el token solo a la UI."""
    user = _active_user(c, user)
    quote = issue_complete_quote(c, user, plan_id, issue_request_id, request, cost)
    token = _issue_confirmation(c, user, quote)
    max_eur = (str(eur_display_max(usd_max=quote['maxTotalUsd'], fx_usd_to_eur=fx_usd_to_eur))
               if fx_usd_to_eur is not None else None)
    return {'card': _card_safe_quote(quote, max_eur),
            'clientConfirmation': {'confirmationToken': token, 'quoteId': quote['quoteId']}}


def confirmar_creacion(c, user, thread_id, quote_id, confirmation_token):
    """RUTA DEL CLIENTE (no herramienta del modelo): con el token que la UI tiene de la tarjeta, aprueba
    el gasto de UNA pieza. Verifica token + cotización sellada vigente + un solo uso; el SERVIDOR pone
    acknowledged=True. Idempotente (un retry legítimo devuelve la misma aprobación, sin doble gasto)."""
    user = _active_user(c, user)
    conf = c.execute('''SELECT quote_id, quote_sha256, created_at FROM creative_estudio_confirmations
        WHERE user_id=%s AND quote_id=%s AND token=%s FOR UPDATE''',
        (user['id'], quote_id, confirmation_token)).fetchone()
    if not conf:
        fail('creative_confirmation_invalid', 'Confirmación de gasto no válida.', 409)
    # C5/C6: TTL finito del token forzado en servidor (vale para el botón y para el «sí» escrito); pasado
    # el TTL hay que re-cotizar. Defensa en profundidad junto a _quote_current (re-cotizar invalida el viejo).
    if datetime.now(timezone.utc) - conf['created_at'] > _CONFIRMATION_TTL:
        fail('creative_confirmation_expired', 'La confirmación ha caducado; pide la cotización otra vez.', 409)
    quote = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND thread_id=%s AND id=%s FOR SHARE''',
        (user['id'], thread_id, quote_id)).fetchone()
    if not quote or quote['quote_sha256'] != conf['quote_sha256']:
        fail('creative_confirmation_invalid', 'Confirmación de gasto no válida.', 409)
    if not _quote_current(c, user, quote):
        fail('creative_quote_stale', 'La cotización ha cambiado; pídela otra vez.', 409)
    # Marca el token como usado una sola vez (en un retry, 0 filas → no reintenta el write-once).
    c.execute('''UPDATE creative_estudio_confirmations SET used_at=now()
        WHERE user_id=%s AND quote_id=%s AND used_at IS NULL''', (user['id'], quote_id))
    # El acknowledged lo pone el SERVIDOR (el cliente confirmó); request_id determinista → idempotente.
    request_id = uuid5(NAMESPACE_URL, 'creative-estudio-confirm:' + str(quote_id))
    approval = approve_exact(c, user, thread_id, quote_id, request_id, quote['quote_sha256'],
                             quote['plan_revision'], quote['plan_sha256'], quote['request_sha256'],
                             quote['max_total_usd'], True)
    return _card_safe_approval(approval)


def estado_estudio(c, user, thread_id, approval_id):
    """Herramienta del MODELO (SOLO lectura): estado de la pieza para la tarjeta de avance. Lee el
    intento §6 de la aprobación; sin intento todavía → 'enCola'. No gasta, no dispara nada. Los TEXTOS
    de la tarjeta salen de las maquetas (owner-UX); aquí solo el estado y el id."""
    user = _active_user(c, user)
    approval = get_approval(c, user, thread_id, approval_id)   # 404 si no es suya
    attempt = c.execute('''SELECT status FROM creative_generation_attempts
        WHERE user_id=%s AND approval_id=%s''', (user['id'], approval_id)).fetchone()
    estado = _ESTADO.get(attempt['status'], 'incierta') if attempt else 'enCola'
    # Regla 1: solo el handle y el estado; el attemptId (interno §6) no sale al modelo/navegador.
    return {'approvalId': approval['approvalId'], 'estado': estado}


def _acceptance_signal(interpretation):
    """Valida la señal del modelo contra el enum TIPADO (C2). FAIL-CLOSED: cualquier valor no reconocido
    NO es aceptación — se rechaza, nunca gasta."""
    try:
        return AcceptanceSignal(interpretation)
    except ValueError:
        fail('creative_acceptance_signal_invalid', 'Señal de aceptación no válida.', 400)


def _audit_written_acceptance(user, quote_id, token, signal, result):
    """C9: recibo de auditoría SERVER-SIDE del «sí» escrito — enum tipado + id interno de token (HASH, no
    el token en claro) + quote + resultado. NO se expone al modelo ni al navegador (D-PROTECCION)."""
    logger.warning('estudio written-acceptance user=%s quote_id=%s token_sha=%s signal=%s result=%s',
                   user['id'], quote_id, sha256(token.encode()).hexdigest()[:16], signal.value, result)


def aceptar_por_texto(c, user, thread_id, quote_id, confirmation_token, interpretation):
    """RUTA DE SERVIDOR/WORKER (NUNCA herramienta del modelo) para el «sí» ESCRITO como aceptación del
    gasto (veredicto 20261022-VEREDICTO-ACEPTACION-SI-ESCRITO-GATE1, C1-C9). El WORKER hace el JOIN: lee el
    token que la UI adjuntó por el canal de SERVIDOR (C1: el token NUNCA va en el prompt ni en args del
    modelo; el modelo solo ve el TEXTO) y la señal TIPADA que el modelo produjo (C2), y llama aquí. El
    servidor confirma SOLO si la señal es ACEPTA (C3): invoca él mismo `confirmar_creacion` (que valida
    token + lote sellado vigente + TTL + un solo uso y pone `acknowledged`). DUDOSO→pregunta y
    NO_ACEPTA→nada, SIN consumir el token (C7: un «sí» genuino posterior, dentro de TTL y lote vigente, aún
    vale). El modelo NUNCA llama a confirmar. Idempotente y auditado (C8/C9).

    COSTURA (interfaz): el canal por el que el token llega en la ENTRADA (metadato de servidor) y cómo el
    worker obtiene del modelo la señal TIPADA (una clasificación que NO gasta). Aquí el token y la
    `interpretation` llegan como argumentos, ya unidos por el worker."""
    user = _active_user(c, user)
    signal = _acceptance_signal(interpretation)
    if signal is not AcceptanceSignal.ACEPTA:
        _audit_written_acceptance(user, quote_id, confirmation_token, signal, 'not_confirmed')
        return {'status': 'ask' if signal is AcceptanceSignal.DUDOSO else 'declined'}
    approval = confirmar_creacion(c, user, thread_id, quote_id, confirmation_token)
    _audit_written_acceptance(user, quote_id, confirmation_token, signal, 'confirmed')
    return {'status': 'confirmed', **approval}
