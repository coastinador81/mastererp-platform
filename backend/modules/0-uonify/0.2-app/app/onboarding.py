"""Alta incremental: cada paso se confirma en una transacción de la cuenta autenticada."""
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from .security import SESSION_COOKIE, digest, require_origin

DOCUMENTS = {'terms': '2026-09-27', 'privacy': '2026-09-27', 'ai-third-party': '2026-09-26'}


class StrictBody(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, strict=True)


class Acceptance(StrictBody):
    id: Literal['terms', 'privacy', 'ai-third-party']
    version: str = Field(max_length=32)


class TermsBody(StrictBody):
    consents: list[Acceptance] = Field(min_length=3, max_length=3)


class PersonalBody(StrictBody):
    firstName: str = Field(min_length=1, max_length=60)
    lastName: str = Field(min_length=1, max_length=90)
    ageRange: Literal['18-24', '25-34', '35-44', '45-54', '55+']


class WorkBody(StrictBody):
    role: Literal['brand', 'seller', 'agency', 'operations', 'professional', 'other']
    companySize: Literal['1', '2-10', '11-50', '51-200', '201+']
    company: str = Field(default='', max_length=100)
    primaryGoal: Literal['catalog', 'operations', 'integrations', 'agents', 'explore']
    source: Literal['', 'search', 'social', 'referral', 'event', 'partner', 'other'] = ''


def onboarding_state(connection, user):
    saved = connection.execute('SELECT data FROM onboarding_profiles WHERE user_id=%s', (user['id'],)).fetchone()
    data = saved['data'] if saved else {}
    rows = connection.execute('''SELECT document_id, version, accepted_at FROM consent_acceptances
        WHERE user_id=%s ORDER BY accepted_at, document_id''', (user['id'],)).fetchall()
    consents = [{'id': row['document_id'], 'version': row['version'], 'acceptedAt': row['accepted_at'].isoformat()} for row in rows]
    accepted = {row['id']: row['version'] for row in consents}
    step = ('terms' if any(accepted.get(key) != version for key, version in DOCUMENTS.items()) else
            'you' if not data.get('ageRange') else 'work' if not data.get('role') else 'pending')
    profile = {**data, 'email': user['email']} if data else None
    return {'profile': profile, 'profileComplete': bool(user.get('onboarding_completed_at')) and step == 'pending', 'ageConfirmedAdult': bool(data.get('ageRange')),
            'onboarding': {'step': step}, 'onboardingStage': 'profile', 'consents': consents}


def require_user(connection, request, allow_deleting=False):
    token = request.cookies.get(SESSION_COOKIE, '')
    user = None
    if token and len(token) <= 256:
        user = connection.execute('''SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
            WHERE token_hash=%s AND expires_at>now() FOR UPDATE OF users''', (digest(token),)).fetchone()
    if not user:
        raise HTTPException(401, detail={'error': 'session_required', 'message': 'Vuelve a iniciar sesión para guardar tus datos.'})
    if user.get('deletion_requested_at') and not allow_deleting:
        raise HTTPException(409, detail={'error': 'account_deletion_pending',
            'message': 'La eliminación de tu cuenta está pendiente. Retómala desde Cuenta para terminar.'})
    return user


def routes(settings, database):
    router = APIRouter(prefix='/api/onboarding')

    def save(request, step, body):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            current = onboarding_state(connection, user)
            if step == 'terms':
                provided = {item.id: item.version for item in body.consents}
                if provided != DOCUMENTS:
                    raise HTTPException(409, detail={'error': 'consent_version', 'message': 'Las condiciones han cambiado. Recarga la página para revisarlas.'})
                for key, version in DOCUMENTS.items():
                    connection.execute('''INSERT INTO consent_acceptances (user_id, document_id, version)
                        VALUES (%s,%s,%s) ON CONFLICT DO NOTHING''', (user['id'], key, version))
            else:
                if current['onboarding']['step'] == 'terms' or (step == 'work' and current['onboarding']['step'] == 'you'):
                    raise HTTPException(409, detail={'error': 'previous_step_required', 'message': 'Completa antes el paso anterior del alta.'})
                connection.execute('''INSERT INTO onboarding_profiles (user_id, data) VALUES (%s,%s)
                    ON CONFLICT (user_id) DO UPDATE SET data=onboarding_profiles.data || EXCLUDED.data,
                    updated_at=now()''', (user['id'], Jsonb(body.model_dump())))
            result = onboarding_state(connection, user)
            connection.execute('UPDATE users SET onboarding_step=%s, updated_at=now() WHERE id=%s',
                               (result['onboarding']['step'], user['id']))
        return result

    @router.post('/complete')
    def complete(request: Request):
        from .access import workspace_access
        from .onboarding_setup import require_setup_ready
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            if workspace_access(connection, user)['status'] != 'allowed':
                raise HTTPException(403, detail={'error':'access_required','message':'Completa tu perfil y confirma tu suscripción antes de entrar.'})
            if not user.get('onboarding_completed_at'):
                require_setup_ready(connection,user)
            user = connection.execute("UPDATE users SET onboarding_completed_at=coalesce(onboarding_completed_at,now()), updated_at=now() WHERE id=%s RETURNING *", (user['id'],)).fetchone()
            return onboarding_state(connection, user)

    @router.post('/terms')
    def terms(body: TermsBody, request: Request):
        return save(request, 'terms', body)

    @router.post('/you')
    def personal(body: PersonalBody, request: Request):
        return save(request, 'you', body)

    @router.post('/work')
    def work(body: WorkBody, request: Request):
        return save(request, 'work', body)

    return router
