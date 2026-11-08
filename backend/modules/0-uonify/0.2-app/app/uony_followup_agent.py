"""D8 («Consultor google», 21-10-2026): a written message while the account's
current work runs is answered at once by a RESTRICTED agent.

Same thread and history as any written order, but only two tools:
get_current_work (status and facts of that work, never Drive content) and
queue_order (this same message becomes the next order, parked until that
work ends). No Drive tool, no request_drive_scope and no tool with another
effect: nothing runs concurrently over Drive or over a scope.
"""

TOOLS = frozenset({'get_current_work', 'queue_order'})
DECLARATIONS = [
    {'name': 'get_current_work', 'description': (
        'Estado real del trabajo que el cliente tiene en curso en esta cuenta: si espera '
        'o se está haciendo, en qué fase, cuánto tiempo lleva y qué pidió. Nunca incluye '
        'contenido de Drive.'),
     'parameters': {'type': 'OBJECT', 'properties': {}}},
    {'name': 'queue_order', 'description': (
        'Deja el mensaje actual del cliente como su siguiente orden: se hará, con todas '
        'las comprobaciones, en cuanto termine el trabajo en curso. Solo si pide hacer algo '
        'nuevo; nunca para una pregunta sobre el trabajo en curso.'),
     'parameters': {'type': 'OBJECT', 'properties': {}}},
]
INSTRUCTION = (
    'Ahora hay otro trabajo del cliente en curso y te escribe mientras tanto. Solo puedes '
    'hacer dos cosas: contarle el estado real de ese trabajo con get_current_work o, si su '
    'mensaje pide hacer algo nuevo, dejarlo en cola con queue_order para hacerlo en cuanto '
    'termine. Ahora no puedes consultar su Drive ni preparar, crear o cambiar nada. Responde '
    'breve y no afirmes ningún resultado que get_current_work no muestre.')
# After queue_order the turn ends without another model call; this text is
# internal (the parked order itself answers the customer when it runs).
QUEUED_REPLY = 'Lo hago en cuanto termine el trabajo en curso.'
STAGES = {'queued': 'en espera', 'preparing': 'preparando los datos',
          'consulting_google': 'preparando la respuesta', 'checking_result': 'comprobando el resultado',
          'saved': 'terminado'}


class FollowupTools(dict):
    """The restricted agent's status: two tools, bound to one message."""

    declarations = DECLARATIONS

    def __init__(self, work, park):
        super().__init__()
        self._work, self._park = work, park
        self.final_reply = None
        self.parked = False

    def call(self, name, args):
        if name not in TOOLS or args:
            return {'error': 'invalid_tool',
                    'message': 'Ahora solo puedo consultar el trabajo en curso o dejar la orden en cola.'}
        if name == 'get_current_work':
            return self._work()
        result = self._park()
        if result.get('status') == 'queued':
            self.parked, self.final_reply = True, QUEUED_REPLY
        return result


def current_work(c, user, target_id):
    """Facts the server holds about the account's current work; no Drive content."""
    row = c.execute('''SELECT j.status,j.progress_stage,r.prompt,
            round(extract(epoch FROM now()-j.created_at)) AS seconds
        FROM uony_conversation_jobs j JOIN uony_requests r
          ON r.user_id=j.user_id AND r.request_id=j.request_id
        WHERE j.user_id=%s AND j.request_id=%s''', (user['id'], target_id)).fetchone()
    if not row:
        return {'error': 'request_not_found', 'message': 'No encuentro ese trabajo.'}
    scope = c.execute('''SELECT operation,target_kind FROM uony_drive_scopes
        WHERE user_id=%s AND request_id=%s''', (user['id'], target_id)).fetchone()
    return {'status': row['status'], 'stage': STAGES.get(row['progress_stage'], row['progress_stage']),
            'elapsedSeconds': int(row['seconds']), 'request': (row['prompt'] or '')[:300],
            'drive': ({'operation': scope['operation'], 'targetKind': scope['target_kind']}
                      if scope else None),
            'rule': 'Hechos del servidor sobre el trabajo en curso; no incluyen contenido de Drive.'}
