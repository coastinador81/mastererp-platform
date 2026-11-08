"""Regla de ciclo de vida CORTO del bucket de generación us-central1 (flujo de medios, Lote A).

BACKSTOP de INV-1: la media del cliente en US (clips de generación + intermedios de montaje) es
TRANSITORIA. El borrado PRIMARIO es explícito, justo tras el montaje (la cadena de custodia:
cleanup). Esta regla de lifecycle es la RED DE SEGURIDAD por si el borrado explícito no corre
(fallo): borra por edad CORTA los objetos bajo el prefijo de intermedios. El bucket/prefijo FINAL
del cliente NO lleva esta regla (el final va al Drive del cliente; Uonify no lo conserva).

Puro y fail-closed: construye/valida el cuerpo `lifecycle` para el PATCH del bucket; NO llama a
GCS. El tope de edad fuerza «corto» estructuralmente (no es la política operativa —el primario es
el borrado post-montaje— sino un tope de sanidad)."""
from __future__ import annotations

# Tope de sanidad: «corto». La política operativa es menor; el primario es el borrado post-montaje.
_MAX_AGE_DAYS = 7


class MediaBucketLifecycleError(Exception):
    """Fail-closed: la regla de lifecycle no es corta o no está bien acotada."""


def intermediates_lifecycle_rule(prefix: str, *, max_age_days: int = 1) -> dict:
    """Cuerpo `lifecycle` para el bucket de intermedios us-central1 (backstop corto).

    Borra por edad `max_age_days` (1..tope) los objetos bajo `prefix`. Fail-closed."""
    if (not isinstance(prefix, str) or not prefix or prefix.startswith("/")
            or ".." in prefix):
        raise MediaBucketLifecycleError("El prefijo de intermedios no es válido.")
    if type(max_age_days) is not int or not 1 <= max_age_days <= _MAX_AGE_DAYS:
        raise MediaBucketLifecycleError(
            f"La edad debe ser un entero corto (1..{_MAX_AGE_DAYS}).")
    return {"rule": [{
        "action": {"type": "Delete"},
        "condition": {"age": max_age_days, "matchesPrefix": [prefix]},
    }]}


def is_short_intermediates_lifecycle(lifecycle: object, prefix: str) -> bool:
    """¿El lifecycle observado del bucket borra por edad CORTA los intermedios bajo `prefix`?

    Para verificar un bucket real tras aplicar la regla. True solo si existe una regla Delete
    acotada a `prefix` con edad 1..tope."""
    if not isinstance(lifecycle, dict) or not isinstance(prefix, str) or not prefix:
        return False
    rules = lifecycle.get("rule")
    if not isinstance(rules, list):
        return False
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        action = rule.get("action")
        condition = rule.get("condition")
        if (isinstance(action, dict) and action.get("type") == "Delete"
                and isinstance(condition, dict)
                and type(condition.get("age")) is int
                and 1 <= condition["age"] <= _MAX_AGE_DAYS
                and isinstance(condition.get("matchesPrefix"), list)
                and prefix in condition["matchesPrefix"]):
            return True
    return False
