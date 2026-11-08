"""Orquestación de la COTIZACIÓN clips-only (data-assembly) — staged + inerte.

Dos helpers puros que la ruta `quote` compone (la ruta HTTP + la llamada al director + el issue_quote
viven en el módulo de ruta):
  * `clips_only_plan_anchor`: ancla la cotización al plan DRAFT del hilo (read-latest). Produce el
    `source_plan_snapshot` EXACTO que `persist_composite_quote` re-valida (`{recipe, plan, skillVersion,
    productId, productRevision}`) + su sha, + plan_id/revision. La CREACIÓN del plan es del ciclo
    conversacional (interfaz, D-UX); aquí SOLO se lee y ancla.
  * `clips_only_persistence_snapshots`: ensambla los 5 `ExecutionPersistenceSnapshots` cuyos
    `canonical_sha256` DEBEN casar con los shas del binding (el ledger los RECHAZA fail-closed si no).

No abren gates, no despachan, no gastan. Lectura del plan = read-only.
"""
from __future__ import annotations

from dataclasses import dataclass

from datetime import datetime
from uuid import UUID

from .creative_batch_pricing import batch_pricing_readiness
from .creative_clips_only_binding import (ClipLimits, clip_limits,
                                          clips_only_execution_binding)
from .creative_clips_only_draft import (clips_only_execution_snapshot_json,
                                        clips_only_video_draft)
from .creative_clips_only_frame_resolver import resolve_clips_only_frame
from .creative_clips_only_input_gate import clips_only_build_manifest_from_assets
from .creative_clips_only_pricing import (clips_only_clip_usage_ceiling,
                                          clips_only_cost_ceilings)
from .creative_clips_only_recipe import clips_only_edit_recipe_json
from .creative_composite_quote import (CompositeQuoteReadiness, canonical_json,
                                       canonical_sha256,
                                       composite_quote_readiness)
from .creative_execution_ledger import ExecutionPersistenceSnapshots
from .creative_execution_operations import video_request_operations


class ClipsOnlyPlanAnchorError(Exception):
    """No hay un plan DRAFT vigente del hilo al que anclar la cotización."""


@dataclass(frozen=True)
class ClipsOnlyPlanAnchor:
    plan_id: str
    plan_revision: int
    project_id: str
    source_plan_sha256: str
    source_plan_snapshot_json: str


def clips_only_plan_anchor(c, *, user_id: str, google_subject: str,
                           thread_id: str) -> ClipsOnlyPlanAnchor:
    """Ancla al plan DRAFT MÁS NUEVO del hilo (read-latest), como exige el motor 090.

    `validate_active_execution_scope` (ledger) re-valida que el plan anclado es el MÁS NUEVO del hilo,
    `status='draft'`, revisión coincidente y del mismo `google_subject`; aquí se reproduce ese anclaje
    (el plan más nuevo del hilo, que DEBE ser draft) y se construye el `source_plan_snapshot` con los
    MISMOS campos crudos que el ledger compara (fail-closed si difieren en persistencia)."""
    row = c.execute(
        '''SELECT id, revision, recipe, plan, skill_version, product_id,
                  product_revision, status, google_subject, project_id
             FROM uony_creative_plans
            WHERE user_id=%s AND thread_id=%s
            ORDER BY created_at DESC, id DESC LIMIT 1''',
        (str(user_id), str(thread_id))).fetchone()
    if not row:
        raise ClipsOnlyPlanAnchorError('No hay plan creativo en este hilo.')
    if (row['status'] != 'draft'
            or row['google_subject'] != google_subject):
        # El plan más nuevo debe ser un DRAFT del propio dueño; si no, el ciclo conversacional
        # (interfaz) debe crear/dejar un DRAFT vigente antes de cotizar el clip.
        raise ClipsOnlyPlanAnchorError('El plan vigente del hilo no es un DRAFT del dueño.')
    source_plan_snapshot = {
        'recipe': row['recipe'], 'plan': row['plan'],
        'skillVersion': row['skill_version'],
        'productId': str(row['product_id']) if row['product_id'] else None,
        'productRevision': row['product_revision'],
    }
    return ClipsOnlyPlanAnchor(
        plan_id=str(row['id']), plan_revision=row['revision'],
        project_id=row['project_id'],
        source_plan_sha256=canonical_sha256(source_plan_snapshot),
        source_plan_snapshot_json=canonical_json(source_plan_snapshot))


def clips_only_persistence_snapshots(
        *, plan_anchor: ClipsOnlyPlanAnchor, execution_snapshot_json: str,
        input_manifest: list, limits: ClipLimits
        ) -> ExecutionPersistenceSnapshots:
    """Ensambla los 5 snapshots persistibles de la cotización.

    `execution_snapshot_json` = `clips_only_execution_snapshot_json(directed, pricing)` (hash ==
    draft.snapshot_sha256). `input_manifest` = `clips_only_build_manifest_from_assets(...)` (su
    canonical_sha256 == el input_manifest_sha256 del binding). El recipe y los límites se canonizan
    aquí para casar `editRecipeSha256`/`limitsSha256`. El ledger (`_persistence_snapshots`) re-verifica
    cada hash fail-closed."""
    return ExecutionPersistenceSnapshots(
        source_plan_snapshot_json=plan_anchor.source_plan_snapshot_json,
        execution_snapshot_json=execution_snapshot_json,
        edit_recipe_json=clips_only_edit_recipe_json(),
        input_manifest_json=canonical_json(input_manifest),
        limits_snapshot_json=canonical_json(limits.payload()))


_CLIP_RESOLUTION = '720p'


def clips_only_build_quote_inputs(
        c, *, user: dict, thread_id: str, asset_id: str,
        aspect_ratio: str, guidance: str, compile_batch,
        issue_request_id: UUID, now: datetime,
        generation_rates=None, infrastructure_rates=None
        ) -> tuple[UUID, CompositeQuoteReadiness, ExecutionPersistenceSnapshots]:
    """Compone TODAS las hojas → `(issue_request_id, readiness, snapshots)` de la cotización del clip.

    Cadena: resolve_clips_only_frame → `compile_batch` (puerto del director de ArtCraft) →
    batch_pricing_readiness → clips_only_video_draft → video_request_operations →
    clips_only_execution_binding → (usage + cost ceilings con rates INYECTADOS) →
    composite_quote_readiness → snapshots.

    Con `generation_rates`/`infrastructure_rates` = None (aún sin fuente verificada por el Consultor) los
    ceilings quedan vacíos → readiness INCOMPLETA (maxEur=null, «sin precio», estado defensivo APROBADO en
    la maqueta): la ruta NO la persiste (no llama issue_clips_only_quote) y deshabilita «Crear». Con techos
    reales → readiness COMPLETA, lista para persistir/autorizar. No abre gates, no despacha, no gasta."""
    frame = resolve_clips_only_frame(c, user_id=user['id'], asset_id=asset_id)
    anchor = clips_only_plan_anchor(
        c, user_id=user['id'], google_subject=user['google_subject'],
        thread_id=thread_id)
    directed = compile_batch(frame, project=anchor.project_id,
                             aspect_ratio=aspect_ratio, guidance=guidance)
    pricing = batch_pricing_readiness(directed.batch)
    draft = clips_only_video_draft(directed, pricing)
    operations = video_request_operations(draft, directed)
    manifest = clips_only_build_manifest_from_assets(
        c, owner_id=user['id'], asset_ids=(asset_id,))
    input_manifest_sha256 = canonical_sha256(manifest)
    limits = clip_limits(directed.batch.requested_seconds, _CLIP_RESOLUTION)
    binding = clips_only_execution_binding(
        draft, operations, plan_id=anchor.plan_id,
        plan_revision=anchor.plan_revision,
        source_plan_sha256=anchor.source_plan_sha256,
        input_manifest_sha256=input_manifest_sha256, limits=limits)
    ceilings: tuple = ()
    if generation_rates is not None and infrastructure_rates is not None:
        try:
            ceilings = clips_only_cost_ceilings(
                binding, directed.batch.requests[0], clips_only_clip_usage_ceiling(),
                generation_rates=generation_rates,
                infrastructure_rates=infrastructure_rates, now=now)
        except ValueError:
            # Fail-closed CONSERVADOR: si los rate snapshots no validan (gate ≤24 h de `_validate_rates`
            # y del `_validate` de infra, completitud de tarifas, o cualquier desajuste de techo contra el
            # binding), se deja la cotización SIN PRECIO (ceilings=()) en vez de mostrar un máximo no
            # evidenciado. El gate corre INTACTO; solo se degrada a «sin precio» (estado defensivo aprobado).
            ceilings = ()
    readiness = composite_quote_readiness(binding, ceilings, now=now)
    snapshots = clips_only_persistence_snapshots(
        plan_anchor=anchor,
        execution_snapshot_json=clips_only_execution_snapshot_json(directed, pricing),
        input_manifest=manifest, limits=limits)
    return issue_request_id, readiness, snapshots
