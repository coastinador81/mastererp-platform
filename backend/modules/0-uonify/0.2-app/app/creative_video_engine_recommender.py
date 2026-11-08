"""Gate de elegibilidad del recomendador «Uony recomienda el tratamiento» (dictamen §5 + veredicto
oferta-motores 27-10). Mecanismo fail-closed, NO la experiencia.

Qué ES esto (mecanismo, mi frontera): dado un candidato y el contexto de la petición, decide si es
ELEGIBLE bajo la política del Consultor: comercial → por defecto GA; un Preview solo es elegible si
el cliente lo pidió EXPLÍCITAMENTE, es data_safe para ese contenido (sin dato personal + Legal leyó
sus términos), y el cliente fue AVISADO de que no está indemnizado. GA exige data_safe (y, en uso
comercial, commercial_ok).

Qué NO es (experiencia = UX del dueño, D-UX-OWNER-DEFINES): CUÁL tratamiento propone Uony de entre
los elegibles, cómo lo redacta, y el aviso/consentimiento del Preview. Eso lo define el dueño y lo
maqueta Frontend-app; aquí solo se filtra lo técnicamente/ legalmente admisible. Los VALORES de
data_safe/commercial_ok los cierra Legal (config inyectada en el registro, nunca inferida).

CORRECCIÓN de Legal (27-10, matriz de términos §CORRECCIÓN) — reglas que gobiernan los flags:
  * `commercial_ok` NO es un toggle del dueño ni del cliente: su valor sale de la allow-list de la
    matriz de Legal (los «Additional Terms GenAI Preview» PROHÍBEN uso comercial/producción + compartir
    salida con terceros salvo modelos EXCEPTUADOS). Con `commercial_ok=False` el gate bloquea ese
    candidato en uso comercial AUNQUE el cliente lo pida — correcto y deseado.
  * Flags finales a poblar en la config (matriz Legal §ACTUALIZACIÓN, página de términos verbatim
    «24-09-2026»): GA (Veo 3.1 estándar/Fast, Nano Banana, Chirp 3 HD, Lyria 2) → data_safe=True,
    commercial_ok=True (indemnizado). Preview EXCEPTUADOS (Veo 3.1 Lite, Omni 1.1, Imagen 4.0 upscale,
    Lyria 3 Clip, Lyria 3 Pro) → data_safe=True*, commercial_ok=True, SIN indemnización. Preview NO
    exceptuados (veo-3.1-generate-preview / veo-3.1-fast-generate-preview, 4K) → data_safe=True*,
    commercial_ok=False. (`data_safe*` de Preview es PER-TRABAJO: dato personal ⇒ no admisible, que el
    gate ya exige con `content_has_personal_data`; GA no lo necesita, tiene DPST.)
  * TIME-SENSITIVE (condición Consultor): la lista de excepción CAMBIA SIN AVISO (Legal vio 17
    versiones). El `commercial_ok=True` de un Preview está anclado a una página FECHADA, no es
    permanente → re-verificar en cada hito / Legal re-lee; la RETIRADA la cubre el kill-switch del
    registro (`enabled`/`retires_at`). No tratar un commercial_ok de Preview como permanente.
  * Resultado para clips comerciales PUBLICADOS (un listing de Amazon cuenta como comercial): GA Veo
    siempre; de los Preview, solo los EXCEPTUADOS (uninsured) y únicamente cuando sean cableables.
    HOY no lo son: Veo 3.1 Lite NO está en el catálogo pinado → el registro lo rechaza por allowlist
    hasta que el Consultor lo añada; Omni se salta fail-closed por precio [NV] y necesita su
    transporte+adopción Interactions propios. El 4K (veo-3.1-*-preview) sigue bloqueado por
    commercial_ok=False.

ORDEN de uso: el gate del recomendador (`eligible_candidates`) corre ANTES de `plan_fallback`
(classifier); así un Preview no exceptuado se excluye por política antes de la cota de presupuesto.

STAGED + INERTE: funciones puras sobre `EngineCandidate`; sin red, sin estado, sin llamador.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .creative_video_engine_registry import EngineCandidate

# Ventana por defecto para re-verificar los términos de un Preview (condición Consultor 27-10: la
# lista de excepción comercial cambia sin aviso → el commercial_ok de un Preview es time-sensitive).
# Conservador; la cadencia real la afinan Legal/el dueño (cada cuánto se comprometen a re-leer la
# página viva). GA no caduca.
DEFAULT_PREVIEW_TERMS_WINDOW = timedelta(days=30)


@dataclass(frozen=True)
class RecommendationContext:
    """Señales de la petición que gobiernan la elegibilidad de un Preview. Defectos fail-closed: uso
    comercial, sin pedido explícito de Preview, sin aviso de no-indemnización.

    `commercial` (aclaración Legal 27-10): debe ser True SIEMPRE que la salida se publique o comparta
    con terceros — un listing de Amazon cuenta, no solo la venta directa —, no solo en una venta. El
    defecto True es la hipótesis fail-closed; un caller solo lo pone False para un uso genuinamente no
    publicado (p. ej. una vista previa interna del propio cliente)."""
    commercial: bool = True
    client_requested_preview: bool = False
    content_has_personal_data: bool = False
    client_warned_not_indemnified: bool = False


def effective_commercial_ok(candidate: EngineCandidate, *, now: datetime,
                            preview_terms_window: timedelta) -> bool:
    """`commercial_ok` EFECTIVO con caducidad (condición Consultor 27-10). Fail-closed.

    - GA: `commercial_ok` tal cual — NO caduca (términos estables + indemnizado).
    - Preview: True SOLO si `commercial_ok` es True Y fue verificado (`commercial_ok_verified_at` no
      None) Y la ventana no venció (`now <= verified_at + preview_terms_window`). Sin verificación o
      vencido ⇒ False (no ofrecible comercial hasta re-verificar). Complementa `enabled`/`retires_at`
      del registro (retirada explícita), no los reemplaza."""
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise TypeError('`now` debe ser datetime con zona horaria.')
    if not isinstance(preview_terms_window, timedelta) or preview_terms_window <= timedelta(0):
        raise TypeError('`preview_terms_window` debe ser un timedelta positivo.')
    if candidate.is_ga:
        return candidate.commercial_ok
    if not candidate.commercial_ok:
        return False
    verified_at = candidate.commercial_ok_verified_at
    if verified_at is None:
        return False
    return now <= verified_at + preview_terms_window


def candidate_eligible(candidate: EngineCandidate, context: RecommendationContext, *,
                       now: datetime,
                       preview_terms_window: timedelta = DEFAULT_PREVIEW_TERMS_WINDOW) -> bool:
    """¿Es admisible este candidato en este contexto? Fail-closed.

    - Uso comercial ⇒ `commercial_ok` EFECTIVO obligatorio (GA y Preview); para Preview, efectivo
      incluye la caducidad (ver `effective_commercial_ok`).
    - GA ⇒ además `data_safe`.
    - Preview ⇒ `data_safe` Y pedido explícito del cliente Y sin dato personal Y cliente avisado de
      que no está indemnizado. Cualquier puerta que falte ⇒ NO elegible (nunca se cuela un Preview)."""
    if not isinstance(candidate, EngineCandidate) or not isinstance(context, RecommendationContext):
        raise TypeError('candidate y context deben ser de los tipos esperados.')
    if context.commercial and not effective_commercial_ok(
            candidate, now=now, preview_terms_window=preview_terms_window):
        return False
    if candidate.is_ga:
        return candidate.data_safe
    return (context.client_requested_preview
            and candidate.data_safe
            and not context.content_has_personal_data
            and context.client_warned_not_indemnified)


def eligible_candidates(candidates: tuple[EngineCandidate, ...],
                        context: RecommendationContext, *, now: datetime,
                        preview_terms_window: timedelta = DEFAULT_PREVIEW_TERMS_WINDOW
                        ) -> tuple[EngineCandidate, ...]:
    """Filtra los candidatos elegibles CONSERVANDO el orden de preferencia del registro. Para uso
    comercial sin Preview explícito esto deja solo los GA (el suelo GA que `resolve` ya garantiza como
    último). La ELECCIÓN final entre los elegibles y su presentación son UX del dueño, no de aquí."""
    if not isinstance(context, RecommendationContext):
        raise TypeError('context debe ser RecommendationContext.')
    return tuple(c for c in candidates
                 if candidate_eligible(c, context, now=now,
                                       preview_terms_window=preview_terms_window))
