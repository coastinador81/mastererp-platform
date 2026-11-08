"""Descubrimiento dinámico de motores vivos en el proyecto del cliente (dictamen 27-10 §C.4/§B).

Lógica del dueño: ofrecer lo que la cuenta Google del cliente tenga VIVO. Este módulo LEE los
publisher models disponibles (solo lectura, nunca UI, nunca genera) y RECONCILIA el registro:
un candidato cuyo model-id no aparezca vivo se DESACTIVA (kill-switch desde descubrimiento). Nunca
activa ni inventa: un model-id vivo que no esté en nuestro catálogo contrastado se reporta como
«desconocido, necesita ficha», no se añade solo (dos verdades del Consultor: no inventar id ni
cuerpo; donde falta prueba, marcar y fijar en real).

STAGED + INERTE, igual que el firmante signBlob: el token (Bearer) y el cliente HTTP se INYECTAN;
keyless; testeable sin red; el endpoint y el scope EXACTOS los verifica el Consultor (hoy [NV], la
doc de Vertex contra el SDK fijado). Fail-closed: cualquier respuesta inesperada → error.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from .creative_google_capabilities import model_launch_stage

TokenProvider = Callable[[], str]
HttpGet = Callable[..., object]       # forma de requests.get(url, *, headers, params, timeout)

# Vertex AI Model Garden — listado de publisher models de Google. La forma EXACTA (v1 vs v1beta1,
# project-scoped vs global, paginación) la fija el Consultor en real; aquí es el seam [NV]. No se
# hardcodea ningún model-id: solo se LEE lo que devuelva.
_AIPLATFORM_HOST = 'https://{location}-aiplatform.googleapis.com'
_PUBLISHER_MODELS_PATH = '/v1beta1/publishers/google/models'

# Sonda de disponibilidad de UN modelo (GET de metadatos, §11 del borrador de ficha de Omni del
# Consultor): host global `aiplatform.googleapis.com` con la location en la RUTA (distinto del
# listado). Es solo-lectura y NO facturable (nunca interactions.create ni predict). Forma [NV] hasta
# que el Consultor la fije en real.
_AIPLATFORM_GLOBAL_HOST = 'https://aiplatform.googleapis.com'
_MODEL_METADATA_PATH = (
    '/v1beta1/projects/{project}/locations/{location}/publishers/google/models/{model_id}')

# NOTA Omni (veredicto Consultor 27-10): Omni NO entrega en gs:// y NO es predictLongRunning
# (GenerateContent + Interactions API, con estado, facturado por tokens, global-only, entrega inline
# base64 / Files API). La adopción gcs de Veo (storage_adopt) NO sirve para Omni: necesita su PROPIO
# transporte Interactions + su PROPIA adopción, que NO existe y vuelve al Consultor con código. En
# este runner Omni ya se salta fail-closed por precio [NV] (plan_fallback); su `api='interactions'`
# queda registrado para que el coordinador futuro ramifique transporte/adopción por candidato.


class EngineDiscoveryError(Exception):
    """Fail-closed: el descubrimiento de motores vivos no se completó de forma verificable."""


class ModelAvailability(Enum):
    """Resultado de la sonda de disponibilidad de un publisher model (§11)."""
    AVAILABLE = 'available'        # 200
    UNAVAILABLE = 'unavailable'    # 404/403
    TRANSIENT = 'transient'        # 429/5xx → reintentar el MISMO GET
    UNKNOWN = 'unknown'            # otro código/ilegible → no cambiar estado (conservador)


@dataclass(frozen=True)
class DiscoveryReconciliation:
    """Resultado de reconciliar el registro con lo vivo."""
    snapshot: dict                       # snapshot con candidatos ausentes forzados a enabled=false
    disabled_models: tuple[str, ...]     # model-ids desactivados por no estar vivos
    unknown_live_models: tuple[str, ...]  # vivos fuera del catálogo → necesitan ficha (no se añaden)


def list_live_publisher_models(*, project: str, location: str,
                               token_provider: TokenProvider, http_get: HttpGet,
                               timeout_seconds: float = 10.0,
                               max_pages: int = 50) -> frozenset[str]:
    """Lee (GET) los publisher models disponibles y devuelve el conjunto COMPLETO de model-ids crudos.

    Solo lectura: ni reserva, ni genera, ni cambia estado. `project` se exige para atar la llamada a
    un proyecto concreto aunque el endpoint de ejemplo sea global (§B: discrepancia a resolver en
    real). Fail-closed ante no-200 o cuerpo ilegible/sin forma de lista.

    PAGINA a completitud (condición FUERTE del Consultor, Q5): si la lista llega truncada y se
    reconciliara con ella, un modelo VIVO en una página posterior se desactivaría por error (falso
    kill). Por eso se sigue `nextPageToken` hasta agotarlo; si no termina en `max_pages`, se LANZA
    (nunca se devuelve un conjunto parcial que reconcile pudiera usar para desactivar). Así el
    contrato es: este listado SOLO devuelve conjuntos completos. Nombres de campo de paginación
    `pageToken`/`nextPageToken` [NV] hasta que el Consultor fije la forma real del endpoint."""
    if not isinstance(project, str) or not project:
        raise EngineDiscoveryError('El proyecto es obligatorio.')
    if not isinstance(location, str) or not location:
        raise EngineDiscoveryError('La región es obligatoria.')
    if not (callable(token_provider) and callable(http_get)):
        raise EngineDiscoveryError('token_provider y http_get deben ser invocables.')
    if not isinstance(max_pages, int) or max_pages <= 0:
        raise EngineDiscoveryError('max_pages debe ser un entero positivo.')
    token = token_provider()
    if not isinstance(token, str) or not token:
        raise EngineDiscoveryError('El proveedor de credencial no devolvió un token.')
    url = _AIPLATFORM_HOST.format(location=location) + _PUBLISHER_MODELS_PATH
    headers = {'Authorization': f'Bearer {token}'}
    ids: set[str] = set()
    page_token: str | None = None
    for _ in range(max_pages):
        params = {'pageToken': page_token} if page_token else {}
        response = http_get(url, headers=headers, params=params, timeout=timeout_seconds)
        if getattr(response, 'status_code', None) != 200:
            raise EngineDiscoveryError(
                f'El listado de modelos respondió {getattr(response, "status_code", None)!r}, no 200.')
        try:
            body = response.json()
        except Exception as error:
            raise EngineDiscoveryError('El listado de modelos no devolvió JSON.') from error
        models = body.get('publisherModels') if isinstance(body, dict) else None
        if not isinstance(models, list):
            raise EngineDiscoveryError('El listado de modelos no trae `publisherModels`.')
        for item in models:
            if not isinstance(item, dict):
                continue
            # El nombre viene como "publishers/google/models/<id>[@version]"; se extrae el <id>.
            name = item.get('name')
            if isinstance(name, str) and '/models/' in name:
                raw = name.split('/models/', 1)[1].split('@', 1)[0]
                if raw:
                    ids.add(raw)
        page_token = body.get('nextPageToken')
        if not page_token:
            break
    else:
        # Agotó max_pages sin terminar de paginar ⇒ lista potencialmente incompleta ⇒ fail-closed.
        raise EngineDiscoveryError(
            'El listado de modelos no terminó de paginar; no se reconcilia con una lista parcial.')
    if not ids:
        raise EngineDiscoveryError('El listado de modelos vino vacío o sin ids legibles.')
    return frozenset(ids)


def probe_publisher_model_availability(*, project: str, location: str, model_id: str,
                                       token_provider: TokenProvider, http_get: HttpGet,
                                       timeout_seconds: float = 10.0) -> ModelAvailability:
    """Sonda NO facturable de disponibilidad de UN modelo (GET de metadatos, §11 del Consultor).

    NUNCA llama interactions.create ni predict (0 coste, 0 generación): solo GET del recurso del
    publisher model. Clasifica como propuso el Consultor: 200=disponible; 404/403=no disponible;
    429/5xx=transitorio (reintentar el MISMO GET); otro/ilegible=desconocido (no cambiar estado).
    NO exige que el model_id esté en el catálogo: sirve para confirmar que un id viejo/retirado
    (p. ej. `gemini-omni-flash-preview`) ya devuelve 404. Repetir contra `global` y `us-central1`
    fija la región real de Omni. Keyless: el token lo inyecta `token_provider`.

    STAGED + INERTE: el `http_get` es inyectado; este módulo no abre red por sí mismo. La CORRIDA
    VIVA de esta sonda está sujeta a la norma del dueño D-ALL-TESTS-REAL-UI-ONLY (que cubre sondas
    de solo-lectura fuera de la UI); no se ejecuta sin que el dueño la levante para este GET."""
    if not isinstance(project, str) or not project:
        raise EngineDiscoveryError('El proyecto es obligatorio.')
    if not isinstance(location, str) or not location:
        raise EngineDiscoveryError('La región es obligatoria.')
    if not isinstance(model_id, str) or not model_id:
        raise EngineDiscoveryError('El model_id es obligatorio.')
    if not (callable(token_provider) and callable(http_get)):
        raise EngineDiscoveryError('token_provider y http_get deben ser invocables.')
    token = token_provider()
    if not isinstance(token, str) or not token:
        raise EngineDiscoveryError('El proveedor de credencial no devolvió un token.')
    url = _AIPLATFORM_GLOBAL_HOST + _MODEL_METADATA_PATH.format(
        project=project, location=location, model_id=model_id)
    response = http_get(url, headers={'Authorization': f'Bearer {token}'},
                        timeout=timeout_seconds)
    code = getattr(response, 'status_code', None)
    if code == 200:
        return ModelAvailability.AVAILABLE
    if code in (403, 404):
        return ModelAvailability.UNAVAILABLE
    if code == 429 or (isinstance(code, int) and 500 <= code < 600):
        return ModelAvailability.TRANSIENT
    return ModelAvailability.UNKNOWN


def reconcile_enabled_with_live(snapshot: object,
                                live_models: frozenset[str]) -> DiscoveryReconciliation:
    """Reconcilia un snapshot de registro con los model-ids vivos. Función pura.

    - Un candidato cuyo model-id NO esté vivo se fuerza a `enabled=false` (kill-switch desde
      descubrimiento). Nunca se activa un candidato: `enabled=true` solo sobrevive si está vivo.
    - Nunca se añade un tratamiento ni un candidato. Un model-id vivo que no esté en el catálogo
      contrastado se reporta en `unknown_live_models` (necesita ficha), no se incorpora solo.
    El snapshot devuelto conserva la estructura; solo cambia `enabled` de los candidatos ausentes.

    CONTRATO DE COMPLETITUD (Consultor Q5): `live_models` DEBE ser el conjunto COMPLETO de modelos
    vivos. `list_live_publisher_models` lo garantiza (pagina a completitud o lanza); NO pasar aquí una
    lista parcial, o un modelo vivo ausente por truncado se desactivaría por error (falso kill)."""
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('treatments'), list):
        raise EngineDiscoveryError('Snapshot de registro con forma inválida.')
    if not isinstance(live_models, (set, frozenset)):
        raise EngineDiscoveryError('`live_models` debe ser un conjunto de model-ids.')
    disabled: set[str] = set()
    new_treatments = []
    for treatment in snapshot['treatments']:
        if not isinstance(treatment, dict) or not isinstance(treatment.get('candidates'), list):
            raise EngineDiscoveryError('Tratamiento con forma inválida.')
        new_candidates = []
        for candidate in treatment['candidates']:
            if not isinstance(candidate, dict) or not isinstance(candidate.get('model'), str):
                raise EngineDiscoveryError('Candidato con forma inválida.')
            model = candidate['model']
            updated = dict(candidate)
            if model not in live_models:
                if updated.get('enabled') is not False:
                    disabled.add(model)
                updated['enabled'] = False      # desactivación, nunca activación
            new_candidates.append(updated)
        new_treatment = dict(treatment)
        new_treatment['candidates'] = new_candidates
        new_treatments.append(new_treatment)
    reconciled = dict(snapshot)
    reconciled['treatments'] = new_treatments
    # Vivos fuera del catálogo contrastado (necesitan ficha; no se añaden solos).
    unknown = tuple(sorted(m for m in live_models if model_launch_stage(m) is None))
    return DiscoveryReconciliation(reconciled, tuple(sorted(disabled)), unknown)
