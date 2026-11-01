from typing import Any
from uuid import UUID

from tenant_security.http import HttpError


def get_progress(conn, auth, session_id: UUID) -> dict[str, Any]:
    session = conn.execute(
        "SELECT id, status, current_step_code, selected_module_codes FROM plataforma.onboarding_sessions WHERE id = %s",
        (session_id,),
    ).fetchone()
    if not session:
        raise HttpError(404, "Session not found")
    steps = conn.execute(
        """
        SELECT r.id, r.step_id, r.response_data, r.status, r.validated_at, s.step_code, s.title, s.position
        FROM plataforma.onboarding_step_responses r
        JOIN plataforma.onboarding_flow_steps s ON s.id = r.step_id
        WHERE r.session_id = %s
        ORDER BY s.position
        """,
        (session_id,),
    ).fetchall()
    return {"session": session, "steps": steps}


def upsert_step(conn, auth, session_id: UUID, step_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    response_data = payload.get("response_data") or {}
    status = payload.get("status") or "submitted"
    row = conn.execute(
        """
        INSERT INTO plataforma.onboarding_step_responses (session_id, step_id, response_data, status, validated_at)
        VALUES (%s, %s, %s::jsonb, %s, CASE WHEN %s = 'validated' THEN now() ELSE NULL END)
        ON CONFLICT (session_id, step_id) DO UPDATE
        SET response_data = EXCLUDED.response_data,
            status = EXCLUDED.status,
            validated_at = EXCLUDED.validated_at,
            updated_at = now()
        RETURNING id, session_id, step_id, response_data, status, validated_at
        """,
        (session_id, step_id, response_data, status, status),
    ).fetchone()
    conn.execute(
        """
        UPDATE plataforma.onboarding_sessions
        SET status = 'in_progress', updated_at = now()
        WHERE id = %s AND status = 'started'
        """,
        (session_id,),
    )
    return {"step_response": row}
