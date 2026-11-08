"""`GoogleAdoptionContextLoader` concreto para CLIPS-ONLY (paso storage_adopt). STAGED + INERTE.

Simétrico al reader/context_loader de google_generation, pero para el paso INTERNO storage_adopt (poll+GCS-adopt,
sin POST). Implementa `GoogleAdoptionContextLoader.load(c, claim) -> (authority, fence, AdoptionContext)` que
consume `run_google_adoption_once`. Reconstruye del mundo 090 (grafo + ledger), keyed por el claim storage_adopt:

  * rehydrate_admitted_execution → approval_id, quote_id, execution_graph_sha256, steps (recibos durables).
  * Paso storage_adopt (claim.step_id): payload {operationId, requestSha256, sourceStepId=dependsOn[0]}
    (rehydration:179-182). `load_google_claim_context` NO sirve aquí (está gateado a google_generation).
  * Paso PADRE google_generation (step_id == sourceStepId): su operation da model/endpoint.
  * Intento SUCCEEDED del padre: result_receipt['providerOperation'] = operation_name (handle LRO Veo) +
    output_prefix (§6, reservado en la generación, 134/137) = expected_output_prefix.

asset_id / revision (fix de entrega 31-10, dueño+CEO «B»; el Consultor lo BENDICE al revisar): **asset_id =
uuid5(NAMESPACE_URL, 'uonify:clips-only-asset:{job_id}:{operation_id}')** — keyado por la INSTANCIA DE
GENERACIÓN (el job_id del claim), NO por el request_operation_id content-determinista. CAUSA DEL BUG anterior
(asset_id=operation_id): el operation_id es uuid5(...snapshot_sha256:ordinal:unit_id:kind), DETERMINISTA SOBRE EL
CONTENIDO del pedido; dos generaciones del MISMO pedido (misma foto+plan) daban el MISMO operation_id → el mismo
asset_id/rev1 → UniqueViolation en la PK (user,asset,revision) al adoptar la 2ª (la generación NO deduplica: op
Veo fresca + cargo). Al keyar por job_id: cada generación = asset propio (rev1), sin colisión; y un RE-DRIVE de la
MISMA generación (mismo job_id+operation_id) reproduce el MISMO asset_id → la adopción 089 sigue create-only
IDEMPOTENTE (el ON CONFLICT (user,snapshot_sha256) la caza). Se incluye operation_id en la semilla para preservar
la distinción por-unidad dentro del job (hoy clips-only = 1 unidad). **revision = 1** (create-only vía
_draft_resolver; cada generación = asset nuevo → siempre rev 1). operation_id/operation_name siguen sirviendo sus
otros roles (output_prefix §6, reconcile LRO) SIN cambios. Entrega/preview resuelven por source_job_id, NO por
asset_id ⇒ el cambio es transparente aguas abajo.

TOKEN POR CLAIM (puerto 4): el handler de adopción (GoogleAdoptionClaimHandler) NO recibe token_provider, así
que este loader lo ACUÑA en load() con un `token_provider_factory` inyectado (un provider cacheado FRESCO por
claim; el inner DEBE ser clips_only_token_provider, anti-CRLF por raise). PATH A (user-OAuth del cliente).

Fail-closed: cualquier incoherencia ⇒ ClipsOnlyAdoptionLoaderError(ValueError) (clasificación terminal, alinea
con run_google_adoption_once). STAGED + INERTE: sin red propia; el token_provider_factory y el registro del
handler los cabla interfaz; VUELVE al Consultor + REA (es spend/dispatch-adjacent: poll+import+adopt con token real).
"""
from __future__ import annotations

import re
from typing import Callable
from uuid import NAMESPACE_URL, UUID, uuid5

from .creative_clips_only_live_provider import ClipsOnlyIdentity
from .creative_google_adoption_runner import AdoptionContext
from .creative_google_generation_authority import (GoogleGenerationAuthority,
                                                   GoogleGenerationFence)

_VEO_LOCATION = 'us-central1'
_ENDPOINT_LOCATION = re.compile(r'/locations/([^/]+)/')


class ClipsOnlyAdoptionLoaderError(ValueError):
    """Fail-closed DETERMINISTA del adoption context_loader clips-only."""


def _location_from_endpoint(endpoint: object) -> str:
    match = _ENDPOINT_LOCATION.search(endpoint) if isinstance(endpoint, str) else None
    location = match.group(1) if match else None
    if location != _VEO_LOCATION:
        raise ClipsOnlyAdoptionLoaderError('La región del endpoint de la operación no es us-central1.')
    return location


class ClipsOnlyAdoptionLoader:
    """`GoogleAdoptionContextLoader` concreto clips-only. `token_provider_factory` inyectado = cabling
    (acuña el Bearer PATH A POR-CLAIM; mismo inner anti-CRLF que la generación). Vuelve al Consultor + REA."""

    def __init__(self, *, token_provider_factory: Callable[[], Callable[[object], str]]) -> None:
        if not callable(token_provider_factory):
            raise ClipsOnlyAdoptionLoaderError('token_provider_factory no es válido.')
        self._token_provider_factory = token_provider_factory

    def load(self, c, claim) -> tuple[GoogleGenerationAuthority, GoogleGenerationFence, AdoptionContext]:
        if getattr(claim, 'kind', None) != 'storage_adopt':
            raise ClipsOnlyAdoptionLoaderError('El claim no es un paso de adopción (storage_adopt).')
        owner = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                          (claim.user_id,)).fetchone()
        if not owner or not owner.get('google_subject'):
            raise ClipsOnlyAdoptionLoaderError('La identidad propietaria no está vigente.')
        from .creative_execution_rehydration import rehydrate_admitted_execution
        restored = rehydrate_admitted_execution(c, owner, UUID(claim.job_id), lock_reads=True)
        if restored.job_id != claim.job_id:
            raise ClipsOnlyAdoptionLoaderError('El trabajo no coincide con el claim.')
        # Paso storage_adopt del claim + su padre google_generation (sourceStepId=dependsOn[0]).
        adopt_steps = tuple(s for s in restored.steps if s.step_id == claim.step_id)
        if len(adopt_steps) != 1 or adopt_steps[0].kind != 'storage_adopt':
            raise ClipsOnlyAdoptionLoaderError('El paso storage_adopt no pertenece al claim.')
        payload = adopt_steps[0].payload
        operation_id = payload.get('operationId') if isinstance(payload, dict) else None
        request_sha256 = payload.get('requestSha256') if isinstance(payload, dict) else None
        source_step_id = payload.get('sourceStepId') if isinstance(payload, dict) else None
        if (operation_id != adopt_steps[0].request_operation_id
                or not isinstance(request_sha256, str) or not source_step_id):
            raise ClipsOnlyAdoptionLoaderError('El paso storage_adopt no liga su operación/padre.')
        parents = tuple(s for s in restored.steps
                        if s.step_id == source_step_id and s.kind == 'google_generation')
        if len(parents) != 1:
            raise ClipsOnlyAdoptionLoaderError('El paso padre google_generation no es único.')
        operation = parents[0].payload.get('operation') if isinstance(parents[0].payload, dict) else None
        if not isinstance(operation, dict) or not isinstance(operation.get('model'), str):
            raise ClipsOnlyAdoptionLoaderError('La operación del padre no es verificable.')
        model = operation['model']
        google_location = _location_from_endpoint(operation.get('endpoint'))
        # Intento SUCCEEDED del padre: operation_name (providerOperation) + output_prefix §6.
        # BELT (Consultor, opción b): la unicidad «≤1 succeeded por paso» es invariante de CONTROL-FLOW
        # (lease/fencing + gate dependsOn=='succeeded', coordinator:583), NO constraint de BD (088 no tiene
        # índice parcial sobre status='succeeded'). Spend/dispatch-adjacent: NO confiar en silencio → exigir
        # EXACTAMENTE uno. 0 (padre no completado) o >1 (doble-despacho upstream) ⇒ fail-closed, nunca adoptar
        # un clip al azar.
        parent_attempts = c.execute(
            '''SELECT output_prefix,result_receipt,provider_started_at
               FROM creative_execution_attempts
               WHERE user_id=%s AND job_id=%s AND step_id=%s AND status='succeeded' FOR SHARE''',
            (claim.user_id, claim.job_id, source_step_id)).fetchall()
        if len(parent_attempts) != 1:
            raise ClipsOnlyAdoptionLoaderError(
                'El paso de generación padre no tiene EXACTAMENTE un intento completado.')
        parent_attempt = parent_attempts[0]
        receipt = parent_attempt.get('result_receipt')
        operation_name = receipt.get('providerOperation') if isinstance(receipt, dict) else None
        output_prefix = parent_attempt.get('output_prefix')
        if (not isinstance(operation_name, str) or not operation_name
                or not isinstance(output_prefix, str) or not output_prefix):
            raise ClipsOnlyAdoptionLoaderError('El intento padre no dejó operación/prefijo verificables.')
        # Cotización del job: proyecto pagador + shas de la autoridad.
        quote = c.execute(
            '''SELECT google_project_id,uonify_project_id,quote_sha256,binding_sha256,
               costs_snapshot_sha256 FROM creative_execution_quotes
               WHERE user_id=%s AND id=%s FOR SHARE''',
            (claim.user_id, restored.quote_id)).fetchone()
        if not quote or not quote.get('google_project_id'):
            raise ClipsOnlyAdoptionLoaderError('Falta la cotización durable del job.')
        google_project = quote['google_project_id']
        # Token PATH A POR-CLAIM (puerto 4): una acuñación fresca para ESTE claim.
        token_provider = self._token_provider_factory()
        if not callable(token_provider):
            raise ClipsOnlyAdoptionLoaderError('El token_provider_factory no devolvió un proveedor.')
        identity = ClipsOnlyIdentity(user_id=claim.user_id,
                                     google_subject=owner['google_subject'],
                                     project_id=google_project)
        token = token_provider(identity)
        if not isinstance(token, str) or not token:
            raise ClipsOnlyAdoptionLoaderError('El token_provider no devolvió un Bearer válido.')
        authority = GoogleGenerationAuthority(
            owner_user_id=claim.user_id, uonify_project_id=quote.get('uonify_project_id'),
            google_project=google_project, google_location=google_location, model=model,
            job_id=claim.job_id, source_step_id=claim.step_id, operation_id=operation_id,
            request_sha256=request_sha256, approval_id=restored.approval_id,
            quote_sha256=quote.get('quote_sha256'), binding_sha256=quote.get('binding_sha256'),
            costs_snapshot_sha256=quote.get('costs_snapshot_sha256'),
            admission_sha256=claim.admission_sha256, claim_set_sha256=claim.claim_set_sha256,
            execution_graph_sha256=restored.execution_graph_sha256)
        fence = GoogleGenerationFence(
            attempt_id=claim.attempt_id, attempt_no=claim.attempt_no,
            claim_lease_token=claim.lease_token, fence_epoch=claim.fence_epoch)
        context = AdoptionContext(
            project=google_project, model=model, operation_name=operation_name, token=token,
            expected_output_prefix=output_prefix,
            expected_location=_VEO_LOCATION.upper(),  # F9(c): check_bucket GCS espera MAYÚSCULAS
            # (la región Vertex de _location_from_endpoint:50 sigue en minúsculas, intacta)
            # Fix entrega B: asset_id POR-INSTANCIA-DE-GENERACIÓN (job_id), no el operation_id
            # content-determinista → sin colisión de PK entre generaciones del mismo pedido;
            # mismo job_id+operation_id en un re-drive ⇒ mismo asset_id ⇒ 089 create-only idempotente.
            asset_id=str(uuid5(
                NAMESPACE_URL,
                f'uonify:clips-only-asset:{claim.job_id}:{operation_id}')),
            owner_project_id=quote.get('uonify_project_id'), revision=1,
            # 29j-B: instante del POST del padre para la ventana de render del age-disambig (staging).
            parent_provider_started_at=parent_attempt.get('provider_started_at'))
        return authority, fence, context
