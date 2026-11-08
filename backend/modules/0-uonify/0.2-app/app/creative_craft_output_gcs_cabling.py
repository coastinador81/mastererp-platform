"""Cableado OFFLINE del executor Craft sobre el primitivo neutral de SC (INACTIVO).

Construye los dos colaboradores que ``GoogleFinalOnlyCraftAdoptionExecutor`` recibe por
inyección:

- ``build_rewrite(plan, durable_bucket) -> kwargs`` de ``rewrite_create_only``: arma el
  recibo de origen (staging), el **nombre durable canónico** (SEED v1 compartido
  ``craft_output_asset_id`` + ``canonical_asset_extension`` compartido, de modo que casa
  byte a byte con lo que registran/resuelven 089/confirm/resolve), los checksums del
  origen (``md5_base64`` y/o ``crc32c``) y ``allowed_buckets``/``expected_location``.
- ``run_rewrite(request) -> StorageReceipt``: adaptador fino que llama a
  ``rewrite_create_only`` (ya con ``session``+``token`` fijados por el llamador).

INERTE: construirlo NO toca GCS; sin llamadas reales hasta el GO (verificación conjunta del
Consultor + autorización de prueba del dueño).

``flow`` es FIJO ``'google'`` (veredicto A del Consultor): las salidas Craft aterrizan en
``creative/staging/google/{owner}/`` (``source_prefix`` que deriva ``rewrite_create_only``);
``dest_prefix`` ``creative/users/{owner}/assets/``. La fila ``'craft'`` ya NO existe en
``_FLOW_PREFIXES``; la procedencia craft-vs-google se registra en el ledger/manifiesto.

Condiciones del Consultor (verificación conjunta pre-prueba-real):
- (1) ``source_metadata`` hace el GET al origen ATADO A LA GENERACIÓN (``source_generation``)
  y devuelve ``{generation, byte_size, content_type, md5_base64?, crc32c?}``; aquí se
  verifica que generación/tamaño/contentType coincidan con el artefacto antes de confiar en
  el checksum (si no, falla cerrado), para que el md5/crc32c no sea de otra versión.
- (4) ``allowed_buckets`` y ``expected_location`` los fija el SERVIDOR (parámetros de la
  composición), nunca el plan; ``expected_location`` es la location que GCS reporta en
  MAYÚSCULAS (p. ej. ``'EUROPE-WEST1'``), comparada verbatim. ``allowed_buckets`` debe
  contener TANTO el bucket de origen COMO el durable (barrera que también exige el primitivo).
"""

from __future__ import annotations

from typing import Callable

from .creative_craft_asset_identity import craft_output_asset_id
from .creative_craft_output_gcs_executor import (
    CraftGcsAdoptionError, GoogleFinalOnlyCraftAdoptionExecutor,
)
from .creative_craft_output_port import CraftArtifactAdoptionPlan
from .creative_google_staging_adoption import canonical_asset_extension
from .creative_storage_contracts import StorageReceipt


# Flujo FIJO de la adopción Craft (veredicto A del Consultor): usa el staging Google.
_CRAFT_ADOPTION_FLOW = "google"

# source StorageReceipt (con generation) -> metadatos del GET atado a esa generación:
# {"generation": int, "byte_size": int, "content_type": str, "md5_base64"?: str,
#  "crc32c"?: str}. Real en el GO; doble offline. GET por generación (cond. 1).
SourceObjectMetadataFn = Callable[[StorageReceipt], dict]
# (**kwargs de rewrite_create_only) -> StorageReceipt (session+token ya fijados)
RewriteCreateOnlyFn = Callable[..., StorageReceipt]


def _authority_owner(authority) -> str:
    """Owner SELLADO del intento Craft (H15 §2), de ``load_craft_attempt_authority``.

    La autoridad es la fila inmutable de BD (``identity.userId``), fuente INDEPENDIENTE de
    ``plan.owner_user_id`` (que viene del escrow vía 089). No acepta texto libre.
    """
    identity = authority.get("identity") if isinstance(authority, dict) else None
    owner = identity.get("userId") if isinstance(identity, dict) else None
    if not isinstance(owner, str) or not owner:
        raise CraftGcsAdoptionError(
            "La autoridad del intento Craft no trae owner sellado.")
    return owner


def build_craft_rewrite_request(
        plan: CraftArtifactAdoptionPlan, durable_bucket: str, *,
        authority, allowed_buckets, expected_location: str,
        source_metadata: "SourceObjectMetadataFn") -> dict:
    """Arma los kwargs de ``rewrite_create_only`` para un artefacto del plan.

    ``flow`` es FIJO ``'google'``. El ``dest_name`` es el durable canónico;
    ``rewrite_create_only`` NO lo calcula, solo valida que empiece por el ``dest_prefix``.

    H15 (§2, owner): el ``owner`` sale de la AUTORIDAD sellada del intento
    (``load_craft_attempt_authority`` → ``identity.userId``), NO de ``plan.owner_user_id``.
    Fail-closed: ``plan.owner_user_id == authority.identity.userId`` (defensa en profundidad;
    el plan ya viene del escrow sellado), y el ``{owner}`` del ``dest_name`` y el
    ``owner_user_id`` enviado se componen con el owner SELLADO.

    H15 (§3, buckets/location — FIJADO): ``allowed_buckets`` = ``settings.creative_output_buckets``
    y ``expected_location`` = ``settings.creative_output_location`` (ambos SC, ``app/settings.py``;
    allowlist de SALIDA/ADOPCIÓN, NO la de ENTRADA de H6). El servidor del rollout los pasa (ver
    ``build_craft_output_adoption_executor_from_settings``); defaults vacíos (``()`` / ``''``) ⇒
    fail-closed. ``expected_location`` va VERBATIM (sin ``.upper()``) y ``_LOCATION`` exige
    MAYÚSCULAS: debe ponerse EXACTO (p. ej. ``'US-CENTRAL1'``); minúscula o ``'global'`` no pasa el
    regex ⇒ rechaza. Verifica generación/tamaño/contentType del origen (cond. 1) y que origen y
    destino estén en ``allowed_buckets`` (cond. 4).
    """
    if not isinstance(plan, CraftArtifactAdoptionPlan):
        raise CraftGcsAdoptionError("Plan de adopción no válido.")
    if not isinstance(durable_bucket, str) or not durable_bucket:
        raise CraftGcsAdoptionError("Bucket durable no válido.")
    owner = _authority_owner(authority)
    if plan.owner_user_id != owner:
        raise CraftGcsAdoptionError(
            "El owner del plan no coincide con la autoridad sellada del intento.")
    allowed = tuple(allowed_buckets)
    art = plan.artifact
    src = plan.source
    source = StorageReceipt(
        src.source_bucket, src.source_name, src.source_generation,
        src.mime_type, src.byte_size, src.sha256)
    if source.bucket not in allowed or durable_bucket not in allowed:
        raise CraftGcsAdoptionError(
            "El bucket de origen y el durable deben estar en allowed_buckets.")
    try:
        asset_id = craft_output_asset_id(
            owner, plan.escrow_id, plan.candidate_id,
            plan.dispatch_id, art.ordinal)
        extension = canonical_asset_extension(art.mime_type)
    except ValueError as error:
        raise CraftGcsAdoptionError(
            f"No se pudo construir el nombre durable: {error}") from error
    dest_name = (f"creative/users/{owner}/assets/{asset_id}/"
                 f"{art.sha256}.{extension}")
    meta = source_metadata(source)
    if not isinstance(meta, dict):
        raise CraftGcsAdoptionError("El GET al origen no devolvió metadatos.")
    if (meta.get("generation") != source.generation
            or meta.get("byte_size") != art.byte_size
            or meta.get("content_type") != art.mime_type):
        raise CraftGcsAdoptionError(
            "El objeto de origen (generación/tamaño/contentType) no coincide con el "
            "artefacto; el checksum podría ser de otra versión.")
    if not any(isinstance(meta.get(key), str) and meta.get(key)
               for key in ("md5_base64", "crc32c")):
        raise CraftGcsAdoptionError(
            "El GET al origen no aportó md5_base64 ni crc32c verificables.")
    expected = {"mime_type": art.mime_type, "byte_size": art.byte_size,
                "sha256": art.sha256}
    for key in ("md5_base64", "crc32c"):
        value = meta.get(key)
        if isinstance(value, str) and value:
            expected[key] = value
    return {
        "source": source, "owner_user_id": owner,
        "flow": _CRAFT_ADOPTION_FLOW, "dest_bucket": durable_bucket,
        "dest_name": dest_name, "expected": expected,
        "allowed_buckets": allowed, "expected_location": expected_location,
    }


def build_google_final_only_craft_executor(
        durable_bucket: str, placement, *, authority, allowed_buckets,
        expected_location: str, source_metadata: "SourceObjectMetadataFn",
        rewrite_create_only: "RewriteCreateOnlyFn",
        ) -> GoogleFinalOnlyCraftAdoptionExecutor:
    """Compone el executor final-only con ``build_rewrite``/``run_rewrite`` reales (INERTE).

    ``authority`` es la autoridad sellada del intento Craft (``load_craft_attempt_authority``),
    de la que sale el owner (H15 §2). ``allowed_buckets``/``expected_location`` los fija el
    servidor desde ``settings`` (H15 §3: ``creative_output_buckets`` / ``creative_output_location``,
    vía ``build_craft_output_adoption_executor_from_settings``), no el plan.
    ``rewrite_create_only`` debe venir con ``session``+``token`` ya fijados por el llamador
    (este módulo no toca credenciales ni red). Un bucket destino en región ≠ ``expected_location``
    lo rechaza ``require_private_bucket`` ANTES del POST (``StorageTransportError``); este módulo no
    reescribe ese tipo (una superficie de error uniforme para el worker es decisión aparte, cuando
    se cablee el worker). Construirlo no abre dispatch ni hace llamadas reales.
    """
    if not callable(source_metadata) or not callable(rewrite_create_only):
        raise CraftGcsAdoptionError("Colaborador del cableado no invocable.")

    def build_rewrite(plan: CraftArtifactAdoptionPlan, bucket: str) -> dict:
        return build_craft_rewrite_request(
            plan, bucket, authority=authority, allowed_buckets=allowed_buckets,
            expected_location=expected_location, source_metadata=source_metadata)

    def run_rewrite(request: dict) -> StorageReceipt:
        return rewrite_create_only(**request)

    return GoogleFinalOnlyCraftAdoptionExecutor(
        durable_bucket, placement, build_rewrite, run_rewrite)


def build_craft_output_adoption_executor_from_settings(
        settings, durable_bucket: str, placement, *, authority,
        source_metadata: "SourceObjectMetadataFn",
        rewrite_create_only: "RewriteCreateOnlyFn",
        ) -> GoogleFinalOnlyCraftAdoptionExecutor:
    """H15 §3: fija la allowlist de SALIDA y la location desde la CONFIG del servidor (INERTE).

    ``allowed_buckets`` = ``settings.creative_output_buckets`` y ``expected_location`` =
    ``settings.creative_output_location`` (ambos SC, ``app/settings.py``). Defaults vacíos
    (``()`` / ``''``) ⇒ fail-closed: el cableado rechaza todo bucket y, ya en el rewrite,
    ``require_private_bucket`` rechaza una location vacía/errónea contra la región REAL del bucket
    en GCS (``StorageTransportError``, ANTES del POST). ``expected_location``
    se usa VERBATIM (sin ``.upper()``): el regex ``_LOCATION`` exige MAYÚSCULAS, así que debe
    configurarse EXACTA (p. ej. ``'US-CENTRAL1'``); minúscula o ``'global'`` no pasa ⇒ fail-closed.
    Este módulo solo LEE ``settings``; no abre dispatch ni toca red. Sin caller vivo hasta el rollout.
    """
    return build_google_final_only_craft_executor(
        durable_bucket, placement, authority=authority,
        allowed_buckets=settings.creative_output_buckets,
        expected_location=settings.creative_output_location,
        source_metadata=source_metadata, rewrite_create_only=rewrite_create_only)
