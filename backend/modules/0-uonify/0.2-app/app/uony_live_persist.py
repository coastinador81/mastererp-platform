"""Persistencia de turnos de voz del gateway — L1 del «guardado a Drive» (veredicto C5 20261027).

Camino de persistencia MÍNIMO y SEPARADO: `LivePersistTurn` → `_save_transcript` → `uony_live_turns`,
SIN tocar semántica/handoff/routing agéntico (eso es PIEZA 3). El subtítulo (`LiveSubtitle`) sigue
INERTE y solo-presentación (C5 del camino en vivo NO se relaja). Fail-closed: un fallo al persistir
NUNCA corta la voz; logs sin contenido (C2). Gateado por `persist` en el gateway (inerte por defecto).

`handle_gateway_io` despacha AMBOS eventos del gateway en un único punto para mantener el router
dentro del límite de 500 líneas (el router está en el techo; ver nota al Consultor).
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime

from .uony_live_bridge import LiveSubtitle, _save_transcript, forward_subtitle

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LivePersistTurn:
    """Turno FINALIZADO para PERSISTIR (distinto del subtítulo de vista). `role` 'user'|'assistant'
    (schema de uony_live_turns, no 'uony'); `finalized_by` = procedencia (user='provider_finished'
    en 3.x; assistant='model_turn_complete'). Campos = los que lee `_save_transcript`."""
    role: str
    turn_id: str
    text: str
    occurred_at: datetime | None = field(default=None, compare=False)
    reply_to_turn_id: str | None = None
    finalized_by: str = ''


async def handle_gateway_io(event, router):
    # Despacho único de los eventos del gateway: LiveSubtitle → vista (WS); LivePersistTurn → persistir.
    if isinstance(event, LiveSubtitle):
        await forward_subtitle(router.sender, event)
        return
    # LivePersistTurn: persist-only (NO contextual_intent/handoff/semantic — eso es PIEZA 3) y
    # FAIL-CLOSED: un fallo al persistir se descarta sin lanzar; nunca corta la voz (C2 sin contenido).
    try:
        _save_transcript(router.database, router.identity, router.session_id, event)
    except Exception as error:
        logger.warning('Live persist turn failed class=%s', type(error).__name__)
