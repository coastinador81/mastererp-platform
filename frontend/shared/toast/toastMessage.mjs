const messages = {
  invalid_transition: "La operación ya no está disponible para el estado actual. Actualiza la información e inténtalo nuevamente.",
  stale_version: "La información cambió mientras trabajabas. Actualiza la vista antes de continuar.",
  idempotency_conflict: "Esta operación ya fue registrada con otros datos.",
  forbidden: "No tienes permiso para realizar esta operación.",
  not_found: "El registro solicitado ya no está disponible.",
  internal_error: "Ocurrió un problema interno. Intenta nuevamente; si continúa, repórtalo al equipo técnico.",
  request_failed: "No se pudo completar la operación. Revisa los datos e inténtalo nuevamente.",
};

export const readableMessage = (value) => messages[String(value || "").trim()] || value || "";
