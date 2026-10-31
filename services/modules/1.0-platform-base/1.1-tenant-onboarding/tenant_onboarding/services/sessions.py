from typing import Any
from uuid import UUID

from tenant_security.http import HttpError


def create_session(conn, auth, payload: dict[str, Any]) -> dict[str, Any]:
    tenant_id = payload.get("tenant_id")
    session = conn.execute(
        """
        INSERT INTO plataforma.onboarding_sessions (tenant_id, initiated_by_user_id, status, context)
        VALUES (%s, %s, 'started', %s::jsonb)
        RETURNING id, tenant_id, initiated_by_user_id, status, current_step_code, context, started_at
        """,
        (tenant_id, auth.user_id, payload.get("context") or {}),
    ).fetchone()
    return {"session": session}


def get_session(conn, auth, session_id: UUID) -> dict[str, Any]:
    session = conn.execute(
        """
        SELECT id, tenant_id, initiated_by_user_id, status, current_step_code,
               selected_module_codes, context, started_at, completed_at
        FROM plataforma.onboarding_sessions
        WHERE id = %s
        """,
        (session_id,),
    ).fetchone()
    if not session:
        raise HttpError(404, "Session not found")
    return {"session": session}


def patch_session(conn, auth, session_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    session = conn.execute(
        """
        UPDATE plataforma.onboarding_sessions
        SET status = COALESCE(%s, status),
            current_step_code = COALESCE(%s, current_step_code),
            selected_module_codes = COALESCE(%s::jsonb, selected_module_codes),
            context = COALESCE(%s::jsonb, context),
            tenant_id = COALESCE(%s, tenant_id)
        WHERE id = %s
        RETURNING id, tenant_id, initiated_by_user_id, status, current_step_code,
                  selected_module_codes, context, started_at, completed_at
        """,
        (
            payload.get("status"),
            payload.get("current_step_code"),
            payload.get("selected_module_codes"),
            payload.get("context"),
            payload.get("tenant_id"),
            session_id,
        ),
    ).fetchone()
    if not session:
        raise HttpError(404, "Session not found")
    return {"session": session}


def complete_session(conn, auth, session_id: UUID) -> dict[str, Any]:
    session = conn.execute(
        """
        UPDATE plataforma.onboarding_sessions
        SET status = 'completed', completed_at = now()
        WHERE id = %s AND status IN ('started', 'in_progress')
        RETURNING id, tenant_id, status, completed_at
        """,
        (session_id,),
    ).fetchone()
    if not session:
        raise HttpError(409, "Session cannot be completed")
    return {"session": session}
