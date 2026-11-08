"""Gate 120B · preflight READ-ONLY de borrado de hilo/proyecto para Craft.

Contrato interno INACTIVO. Este módulo no se cablea a ninguna ruta por sí mismo:
Interfaz lo inyecta por DI en el seam de ``uony_projects`` (factory
``routes(settings, database, preflight=None)``), y mientras ese ``preflight``
quede en ``None`` el comportamiento actual no cambia (los tests siguen verdes).

Problema que resuelve (único P1 de activación de 120B):
``erase_threads`` borra ``uony_creative_plans`` por ``thread_id``. Si un plan
tiene historial de consumo Craft (una fila en
``creative_craft_input_plan_head_consumptions`` cuya FK ``(user_id, plan_id)`` a
``uony_creative_plans`` es NO ACTION), ese DELETE falla con ``psycopg.Error`` y
el handler global devuelve ``503 database_unavailable`` tras un rollback que
conserva plan, head y consumption. Este preflight detecta esa condición ANTES de
cualquier mutación y la convierte en un ``409`` de dominio estable.

Invariantes (fijadas con Interfaz):
  * READ-ONLY: solo SELECT; no toma locks nuevos (sin FOR UPDATE ni advisory).
    El orden de candados y la transacción los orquesta Interfaz; corremos dentro
    de la connection/transacción que nos pasa.
  * Nunca cascade, nunca borra ledgers. No altera el esquema.
  * Fail-closed: ninguna ``psycopg.Error`` ni excepción arbitraria escapa; todo
    fallo se mapea al mismo ``409`` estable para no degradar a 503/500.
  * ``statement_timeout`` corto SOLO para nuestros SELECT, restaurado antes de
    devolver el control, para no alterar las sentencias posteriores de Interfaz.
  * Sin I/O de red con la transacción abierta.
"""

from __future__ import annotations

from fastapi import HTTPException

# Código de dominio a nivel de ruta: sustantivo corto, sin prefijo de módulo
# (estilo de la casa para 409 de ruta, p. ej. thread_busy), fijado por Interfaz.
CONSUMPTION_PRESENT = "craft_consumption_present"
_MESSAGE = (
    "No podemos eliminar esto todavía porque conserva historial de creación "
    "Craft ya consumido. No se ha eliminado nada; inténtalo de nuevo más tarde."
)
_STATEMENT_TIMEOUT_MS = 3000


def _consumption_present(connection, user_id, thread_ids) -> bool:
    """¿Algún plan de estos hilos tiene consumption histórica que bloquee el borrado?

    Coincide exactamente con el objetivo del DELETE de ``erase_threads``
    (``uony_creative_plans`` cuyo ``thread_id`` está en la lista): si una de esas
    filas está referenciada por una consumption, el borrado fallaría cerrado.
    """
    row = connection.execute(
        """SELECT 1
             FROM creative_craft_input_plan_head_consumptions consumption
             JOIN uony_creative_plans plan
               ON plan.user_id = consumption.user_id
              AND plan.id = consumption.plan_id
            WHERE consumption.user_id = %s
              AND plan.thread_id = ANY(%s)
            LIMIT 1""",
        (user_id, thread_ids),
    ).fetchone()
    return row is not None


def craft_consumption_preflight(connection, user, ids, project_id=None) -> None:
    """Lanza un 409 estable si borrar estos hilos chocaría con consumption Craft.

    Pensado para inyectarse como ``preflight`` del seam de ``uony_projects``.
    Devuelve ``None`` (sigue el borrado) solo si no hay historial consumido.
    """
    thread_ids = [str(thread_id) for thread_id in (ids or [])]
    if not thread_ids:
        return
    restore_timeout = None
    try:
        restore_timeout = connection.execute(
            "SELECT current_setting('statement_timeout') AS value"
        ).fetchone()["value"]
        connection.execute(
            "SELECT set_config('statement_timeout', %s, true)",
            (str(_STATEMENT_TIMEOUT_MS),),
        )
        present = _consumption_present(connection, user["id"], thread_ids)
    except HTTPException:
        raise
    except Exception:
        # Fail-closed: cualquier fallo (incluido un timeout) se trata como
        # "no se puede borrar con seguridad" y se mapea al 409 estable, nunca a
        # 503/500. La transacción la revierte la ruta al propagar el 409.
        raise HTTPException(
            409, detail={"error": CONSUMPTION_PRESENT, "message": _MESSAGE}
        ) from None
    # Camino limpio: restaurar el timeout del llamador antes de seguir el borrado.
    if restore_timeout is not None:
        try:
            connection.execute(
                "SELECT set_config('statement_timeout', %s, true)",
                (restore_timeout,),
            )
        except Exception:
            pass
    if present:
        raise HTTPException(
            409, detail={"error": CONSUMPTION_PRESENT, "message": _MESSAGE}
        )
