"""Bootstrap del registry de handlers del worker clips-only (STAGED + INERTE).

Arma el dict de handlers que EXIGE `_validate_handlers` del runner (creative_execution_runner:267): su set de
claves debe ser EXACTAMENTE `CREATIVE_STEP_KINDS` (los 5), cada uno con run/cancel invocables. En el piloto
clips-only SOLO se reclaman 'google_generation' y 'storage_adopt' (el grafo `build_clips_only_execution_graph`
solo emite esos dos pasos); el resto (craft/candidate_adopt/review, y cualquier kind FUTURO) va como STUB
FAIL-CLOSED: su `run()` RAISEA (nunca procesa, nunca gasta) y `cancel()` es un no-op seguro. Así un worker
clips-only pasa la validación de los 5 kinds SIN poder procesar un paso que no le corresponde (defensa en
profundidad: aunque un bug/otro flujo admitiera un paso ajeno, el stub lo rechaza antes de cualquier efecto).

Los 2 handlers REALES los CONSTRUYE e INYECTA el cableado (interfaz) con sus context_loaders + token-factory +
gate_decider + session_factory (la misma DI que arma para el endpoint): google_generation =
GoogleGenerationClaimHandler, storage_adopt = GoogleAdoptionClaimHandler. Este módulo NO los construye ni abre
red/SQL: solo ensambla el registry + los stubs. El PROCESO/loop del worker (claim_and_run_one en bucle +
recover_and_reconcile_expired periódico) y su arranque los pone el entrypoint de deploy del worker; esto solo da
el registry para ese arranque. Fail-closed. STAGED + INERTE: no lo llama nada vivo. VUELVE a Consultor + REA.
"""
from __future__ import annotations

from .creative_execution_coordinator import CreativeAttemptClaim
from .creative_execution_runner import CREATIVE_STEP_KINDS

# Kinds que EMITE el grafo clips-only (build_clips_only_execution_graph, creative_execution_graph.py:264/268:
# google_generation → storage_adopt; NINGÚN otro) = los kinds que DEBEN tener handler REAL (no stub). COND
# C-WRK-1 del Consultor (§8.12): si el grafo se extiende a otro kind, ACTUALIZAR esta constante Y la inyección
# de reales; el belt de build_clips_only_handlers convierte un desajuste en un fallo de BOOTSTRAP (no un RAISE en
# claim-time). El resto de CREATIVE_STEP_KINDS se cubre con stubs fail-closed.
_CLIPS_ONLY_REAL_KINDS = frozenset({'google_generation', 'storage_adopt'})


class ClipsOnlyWorkerBootstrapError(Exception):
    """Fail-closed: el registry de handlers del worker clips-only no se pudo armar de forma válida."""


class _ClipsOnlyFailClosedHandler:
    """Stub fail-closed para un kind que el piloto clips-only NUNCA reclama (el grafo no lo emite).

    Forma `CreativeClaimHandler` (run/cancel) para pasar `_validate_handlers`. `run()` RAISEA — si por un bug o
    por otro flujo se reclamara este kind, NUNCA procesa ni gasta; `cancel()` es un no-op seguro (no deja efecto
    local cancelable). No define prepare/reconcile (opcionales en el runner)."""

    def __init__(self, kind: str) -> None:
        self._kind = kind

    def run(self, claim: CreativeAttemptClaim):
        raise ClipsOnlyWorkerBootstrapError(
            f"El paso '{self._kind}' no se procesa en el worker clips-only (fail-closed).")

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        return True


def build_clips_only_handlers(*, google_generation_handler,
                              storage_adopt_handler) -> dict:
    """Registry de los `CREATIVE_STEP_KINDS` para el worker clips-only: los 2 reales inyectados + el resto como
    stubs fail-closed DERIVADOS de `CREATIVE_STEP_KINDS` (un kind nuevo entra como fail-closed por defecto, nunca
    como hueco). Fail-closed: exige que los 2 reales tengan run/cancel y que el dict final cubra EXACTAMENTE los
    5 kinds (misma comprobación que hará `_validate_handlers` del runner)."""
    reals = {'google_generation': google_generation_handler,
             'storage_adopt': storage_adopt_handler}
    # COND C-WRK-1 (Consultor §8.12): la constante de kinds reales debe ser un subconjunto válido del set
    # autoritativo del runner, y los handlers reales inyectados deben ser EXACTAMENTE los kinds que emite el
    # grafo clips-only. Si el grafo se extendiera a un 3er kind y se actualizara _CLIPS_ONLY_REAL_KINDS sin
    # inyectar su handler real, este belt FALLA en BOOTSTRAP (no en claim-time, que sería fail-closed pero tardío).
    if not _CLIPS_ONLY_REAL_KINDS <= set(CREATIVE_STEP_KINDS):
        raise ClipsOnlyWorkerBootstrapError(
            "_CLIPS_ONLY_REAL_KINDS no es subconjunto de CREATIVE_STEP_KINDS.")
    if set(reals) != _CLIPS_ONLY_REAL_KINDS:
        raise ClipsOnlyWorkerBootstrapError(
            "Los handlers reales no coinciden con los kinds que emite el grafo clips-only (C-WRK-1).")
    for kind, handler in reals.items():
        if (not callable(getattr(handler, 'run', None))
                or not callable(getattr(handler, 'cancel', None))):
            raise ClipsOnlyWorkerBootstrapError(
                f"El handler real '{kind}' no es un CreativeClaimHandler válido (run/cancel).")
    handlers = dict(reals)
    for kind in CREATIVE_STEP_KINDS:
        if kind not in handlers:
            handlers[kind] = _ClipsOnlyFailClosedHandler(kind)
    if set(handlers) != set(CREATIVE_STEP_KINDS):
        raise ClipsOnlyWorkerBootstrapError(
            "El registry del worker clips-only no cubre exactamente los CREATIVE_STEP_KINDS.")
    return handlers
