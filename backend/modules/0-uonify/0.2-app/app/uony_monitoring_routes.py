"""Authenticated, content-free monitoring for the owner's persistent work."""
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, Request
from .onboarding import require_user
from .uony_conversation_queue import ConversationQueue
from .uony_live_delivery_store import delivery_metrics, narration_budget_ms


def routes(database):
    router = APIRouter(prefix='/api/uony')

    @router.get('/monitoring/queue')
    def snapshot(request: Request, projectId: UUID | None = None,
                 windowSeconds: int = Query(default=3600, ge=60, le=86400)):
        with database.connect() as c:
            user = require_user(c, request)
            if projectId is not None and not c.execute('''SELECT 1 FROM uony_projects
                WHERE user_id=%s AND id=%s AND deleted_at IS NULL''',
                (user['id'], projectId)).fetchone():
                raise HTTPException(404, detail={'error': 'project_not_found',
                    'message': 'No se encuentra este proyecto en tu cuenta.'})
            result = ConversationQueue(database, (), 1).metrics(c, user,
                project_id=projectId, window_seconds=windowSeconds)
            result['voiceDelivery'] = delivery_metrics(c, user, projectId, windowSeconds)
            result['budgetsMs']['resultToAudioMs'] = narration_budget_ms()
            for item in result['voiceDelivery']:
                value = item['resultToAudioP95Ms']
                if value is not None and value > narration_budget_ms():
                    result['alerts'].append({'code': 'voice_delivery_over_budget',
                        'metric': 'resultToAudioMs', 'observedMs': value,
                        'budgetMs': narration_budget_ms()})
            return result

    return router
