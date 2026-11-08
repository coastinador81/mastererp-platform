"""Bootstrap del plan DRAFT del clip simple (motor 090) — hilo Estudio DEDICADO (modelo B). STAGED + INERTE.

El motor 090 exige un plan DRAFT anclado al hilo ANTES de cotizar (`clips_only_plan_anchor`). El flujo
«subir foto → Animar con Uony» se salta el «configurar» conversacional, así que no existe ese plan y
`POST /quote` daba 409. Este módulo lo ASEGURA (reuse-or-create) de forma invisible, como GEMELO FIEL de
`CreativeTools.commit` (creative_planning.py:214-244), respetando las condiciones verbatim de los guardianes:

- MODELO DE HILO = B (decisión del dueño): el DRAFT vive en un hilo Estudio DEDICADO, no en el del chat →
  `get_creative_plan`/`get_creative_preparation` del hilo del chat NO lo leen (sin «tarjeta fantasma»). Las
  tarjetas siguen renderizándose inline en la conversación (sin cambio visible). El hilo dedicado se
  identifica de forma ESTABLE por `ESTUDIO_CLIP_THREAD_PREFIX + <id del hilo del chat>` → el frontend usa ese
  thread_id dedicado en subida/quote/authorize (contrato B); determinista ⇒ el advisory lock + reuse
  serializan (sin drafts duplicados en /quote concurrentes).
- C1 (Consultor): receta R1 ∈ RECIPES NO-comercial = `reference_video` (VEO 3.1 Fast). La clave NO es visible
  al cliente (D-PROTECCIÓN). R2 (receta dedicada `estudio_clip` + mig 134) = follow-up.
- C2 / C-INV (REA, load-bearing): el `plan` JSONB se construye COMO commit, nunca a mano:
  `PlanInput(recipe, objective≥8).model_dump()` + `modelSnapshot = route(...)` (garantiza 'medium') +
  `sourceSha256 = SOURCE_SHA256`. `recipe ∈ RECIPES` y `objective ≥ 8` son load-bearing (si no,
  `get_creative_preparation` / `compile_skill_plan` revientan a 500 si alguna vez se inspecciona el draft).
- C3 (inv-013): la conexión Cloud se selecciona por `(user, google_subject=dueño, status='connected')` y se
  escribe ESE `project_id` (Google) en el plan.
- B-INV-1 (REA): clave del advisory lock BYTE-IDÉNTICA a commit (planning.py:227), mismo texto/orden/semilla,
  **xact** (no de sesión); solo cambia a qué hilo apunta (el dedicado).
- B-INV-2 / C4: `ensure` corre DENTRO de /quote, ANTES del anchor, con la MISMA conexión; el xact lock queda
  retenido hasta el commit que cubre anchor+persist.

No abre gate, no despacha, no gasta: solo deja un DRAFT (`spend_limit_usd=0`) para que el motor 090 ancle.
INERTE: la ruta /quote que lo invoca no se monta hasta OK Consultor+REA (re-x-ray vivo) + dueño + flip.
"""
from __future__ import annotations

from uuid import uuid4

from psycopg.types.json import Jsonb

from .creative_planning import (PlanInput, SKILL_VERSION, SOURCE_SHA256, route)

# Prefijo reservado del hilo Estudio DEDICADO (modelo B). Debe ser IMPOSIBLE que un id de hilo del chat
# empiece por él (lo garantiza el generador de hilos del frontend); así los endpoints de clip solo operan
# sobre hilos dedicados (fail-closed) y el DRAFT nunca cae en el hilo del chat.
ESTUDIO_CLIP_THREAD_PREFIX = 'estudio-clip:'

# C1: receta R1, válida en RECIPES y NO comercial (no exige público/oferta). VEO 3.1 Fast.
_CLIP_RECIPE = 'reference_video'
# C2: objective ≥ 8 chars OBLIGATORIO (si no, creative_preparation_service revienta a 500).
_CLIP_OBJECTIVE = 'Animar la foto del producto con un movimiento sutil y fiel al producto.'


class ClipsOnlyPlanBootstrapError(Exception):
    """No se pudo asegurar el plan DRAFT del clip (fail-closed)."""


class ClipsOnlyCloudNotReadyError(ClipsOnlyPlanBootstrapError):
    """La conexión Google Cloud del cliente no está vigente (→ 409 `cloud_not_ready`)."""


def estudio_clip_thread_id(chat_thread_id: str) -> str:
    """Id ESTABLE del hilo Estudio dedicado del clip (modelo B): prefijo reservado + id del hilo del chat.
    Determinista ⇒ el advisory lock + reuse serializan. El frontend compone el MISMO valor (contrato B)."""
    return f'{ESTUDIO_CLIP_THREAD_PREFIX}{chat_thread_id}'


def is_estudio_clip_thread(thread_id: str) -> bool:
    """True si `thread_id` es un hilo Estudio dedicado (prefijo reservado). Los endpoints de clip lo exigen."""
    return thread_id.startswith(ESTUDIO_CLIP_THREAD_PREFIX)


def clips_only_ensure_plan_anchor(c, *, user: dict, thread_id: str) -> None:
    """Asegura (reuse-or-create) un plan DRAFT en el hilo Estudio DEDICADO `thread_id` (ya prefijado, modelo B).

    DEBE llamarse con la MISMA conexión `c` de /quote, ANTES del anchor: el advisory XACT lock queda retenido
    hasta el commit que cubre anchor+persist (B-INV-2/C4). Idempotente bajo ese lock: dos /quote concurrentes
    se serializan; el segundo reutiliza el DRAFT del primero (newest=draft) y no crea otro. No gasta."""
    user_id = user['id']
    google_subject = user['google_subject']
    # B-INV-1: clave del advisory lock BYTE-IDÉNTICA a commit (planning.py:227): mismo texto/orden/semilla, xact.
    c.execute('''SELECT pg_advisory_xact_lock(
            hashtextextended(%s::text || ':' || %s,0))''',
        (user_id, thread_id)).fetchone()
    # Reuse: si el plan MÁS NUEVO del hilo dedicado ya es un DRAFT del dueño, no se crea otro (idempotente).
    # Mismo orden que el anchor y el ledger (created_at DESC, id DESC).
    newest = c.execute('''SELECT id, status, google_subject FROM uony_creative_plans
        WHERE user_id=%s AND thread_id=%s
        ORDER BY created_at DESC, id DESC LIMIT 1''',
        (user_id, thread_id)).fetchone()
    if (newest and newest['status'] == 'draft'
            and newest['google_subject'] == google_subject):
        return
    # C3 (inv-013): conexión Cloud por (user, google_subject=dueño, connected) → su project_id (Google text).
    connection = c.execute('''SELECT project_id FROM google_cloud_connections
        WHERE user_id=%s AND google_subject=%s AND status=%s''',
        (user_id, google_subject, 'connected')).fetchone()
    if not connection or not connection['project_id']:
        raise ClipsOnlyCloudNotReadyError('La conexión Google Cloud del cliente no está vigente.')
    project_id = connection['project_id']
    # FK (user,thread)→uony_threads: asegurar el hilo dedicado. project_id NULL permitido (uony_threads.project_id
    # nullable; creative_execution_quotes.uonify_project_id nullable); no se copia el proyecto uonify del chat.
    c.execute('''INSERT INTO uony_threads(user_id, id, title)
        VALUES(%s, %s, %s) ON CONFLICT (user_id, id) DO NOTHING''',
        (user_id, thread_id, 'Estudio'))
    # C2/C-INV: plan JSONB construido COMO commit (PlanInput + route), nunca a mano. recipe ∈ RECIPES y
    # objective ≥ 8 son load-bearing; modelSnapshot = route(...) garantiza 'medium' (latest()/response() seguros).
    prepared = PlanInput(recipe=_CLIP_RECIPE, objective=_CLIP_OBJECTIVE).model_dump()
    model = route(_CLIP_RECIPE, project_id, None)
    stored_plan = {**prepared, 'modelSnapshot': model, 'sourceSha256': SOURCE_SHA256}
    # INSERT con las columnas EXACTAS de commit (planning.py:230-238); status/revision/spend por default
    # (draft/1/0). origin_request_id = uuid4 fresco (la idempotencia la da el advisory lock + reuse del más
    # nuevo, NO un origin determinista — ver docstring). product_id/revision NULL (draft no vinculado).
    c.execute('''INSERT INTO uony_creative_plans
        (user_id,id,google_subject,project_id,thread_id,origin_request_id,
         product_id,product_revision,skill_version,recipe,plan)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id,origin_request_id) DO NOTHING RETURNING id''',
        (user_id, uuid4(), google_subject, project_id, thread_id, uuid4(),
         None, None, SKILL_VERSION, _CLIP_RECIPE, Jsonb(stored_plan))).fetchone()
