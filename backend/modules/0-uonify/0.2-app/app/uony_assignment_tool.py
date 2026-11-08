"""Stage one customer goal; persist it only with the successful chat turn.

This tool records conversation context. It cannot create a product, read Drive,
schedule analysis or authorize an operation. The model may propose an intent,
but the server binds its evidence to the current user message and account.
"""
from uuid import uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .uony_assignments import _focus


DECLARATION = {
    'name': 'remember_assignment',
    # By intention, as a person would understand it (lote 6, A5; owner's principle
    # of conversational fluency): the model decides; the server keeps provenance.
    'description': ('Guarda el encargo de preparar un producto para Amazon cuando el cliente '
                    'quiera de verdad empezar a prepararlo, lo diga como lo diga; no si solo '
                    'pregunta, imagina o lo descarta, ni si continúa un encargo ya guardado. '
                    'No crea ficha, SKU, análisis ni autorización. startingPoint, según lo '
                    'entiendas: materials si ya tiene fotos, documentos u otros materiales; '
                    'from_scratch si parte de cero; unknown si no lo sabes. Cita el mensaje '
                    'actual completo.'),
    'parameters': {'type': 'OBJECT', 'properties': {
        'kind': {'type': 'STRING', 'enum': ['amazon_product']},
        'label': {'type': 'STRING', 'description': ('Nombre corto dicho por el cliente; usa '
                  'Producto en Amazon si todavía no tiene nombre.')},
        'intentQuote': {'type': 'STRING', 'description': 'Mensaje actual completo del cliente.'},
        'startingPoint': {'type': 'STRING', 'enum': ['unknown', 'materials', 'from_scratch']},
    }, 'required': ['kind', 'label', 'intentQuote', 'startingPoint']},
}

GENERIC_LABEL = 'Producto en Amazon'
NEXT_STEP = {'unknown': 'clarify_source', 'materials': 'select_folder',
             'from_scratch': 'select_product'}


def _normal(text):
    return ' '.join(text.split()).casefold()


class AssignmentTools:
    def __init__(self, database, user, thread_id, request_id, user_text):
        self.database, self.user = database, user
        self.thread_id, self.request_id = thread_id, request_id
        self.user_text = user_text
        self.prepared = None
        self.rejected = False

    def prepare(self, args):
        if not isinstance(args, dict) or set(args) != {
                'kind', 'label', 'intentQuote', 'startingPoint'}:
            return {'error': 'invalid_tool', 'message': 'Faltan datos del encargo propuesto.'}
        label, quote, source = args['label'], args['intentQuote'], args['startingPoint']
        if (args['kind'] != 'amazon_product' or not isinstance(label, str) or
                not isinstance(quote, str) or not isinstance(source, str) or
                source not in NEXT_STEP or
                not self.thread_id or not self.request_id):
            return {'error': 'invalid_tool', 'message': 'No podemos identificar este encargo.'}
        label = ' '.join(label.split())
        objective = ' '.join(self.user_text.split())
        # An exact current-turn quote prevents a retrieved document or an old
        # conversation turn from becoming an instruction to store a new goal.
        if (not 1 <= len(label) <= 80 or not 12 <= len(objective) <= 500 or
                _normal(quote) != _normal(objective) or
                label != GENERIC_LABEL and _normal(label) not in _normal(objective)):
            self.rejected = True
            return {'error': 'invalid_intent',
                    'message': 'No hay una petición nueva suficientemente clara en este mensaje. Pregunta antes de guardarla.'}
        # Lote 6 (A5): where the customer starts is what the model understood.
        proposal = {'label': label, 'objective': objective, 'startingPoint': source}
        other = self._same_label_other_goal(label, objective)
        if other:
            # Another goal with this name in the thread: the model asks, in its own
            # words, whether to continue it or start a different one (no fixed text).
            # A new one needs a name of its own, since the label must be the
            # customer's words: without it the model could only ask again.
            return {'error': 'assignment_exists', 'label': other,
                    'message': 'Ya hay un encargo con ese nombre en esta conversación. Pregunta al '
                               'cliente con naturalidad si quiere seguir con ese o empezar otro '
                               'distinto y, si es otro, cómo quiere llamarlo (por ejemplo, el nombre '
                               'del producto). No guardes nada en este mensaje.'}
        if self.prepared:
            return ({'prepared': True, 'message': 'Ya está preparado este encargo.'}
                    if proposal == self.prepared else
                    {'error': 'one_change', 'message': 'Prepara un solo encargo por mensaje.'})
        self.prepared = proposal
        return {'prepared': True, 'message': 'Guardaré solo el objetivo y el punto de partida. '
                'Aún no he creado una ficha, leído Drive ni iniciado un análisis.'}

    def _same_label_other_goal(self, label, objective):
        """The label of an assignment of this thread with this name and another goal."""
        with self.database.connect() as c:
            rows = c.execute('''SELECT label,objective FROM uony_assignments
                WHERE user_id=%s AND google_subject=%s AND origin_thread_id=%s
                  AND lower(label)=lower(%s)''', (self.user['id'], self.user['google_subject'],
                                                  self.thread_id, label)).fetchall()
        return next((row['label'] for row in rows
                     if _normal(row['objective']) != _normal(objective)), None)

    def commit(self, c, user):
        if not self.prepared:
            return None
        if user['id'] != self.user['id'] or user['google_subject'] != self.user['google_subject']:
            raise HTTPException(409, detail={'error': 'account_changed',
                'message': 'La cuenta cambió antes de guardar el encargo.'})
        saved = c.execute('''SELECT * FROM uony_assignments WHERE user_id=%s
            AND origin_request_id=%s''', (user['id'], self.request_id)).fetchone()
        if saved:
            if (saved['google_subject'] != user['google_subject'] or
                    saved['origin_thread_id'] != self.thread_id or
                    saved['label'] != self.prepared['label'] or
                    saved['objective'] != self.prepared['objective']):
                raise HTTPException(409, detail={'error': 'assignment_request_conflict',
                    'message': 'Esta solicitud corresponde a otro encargo.'})
            return {'id': saved['id'], 'label': saved['label'], 'created': False,
                    'focusVersion': _focus(c, user, self.thread_id)['version']}
        focus = _focus(c, user, self.thread_id)
        same_label = c.execute('''SELECT * FROM uony_assignments
            WHERE user_id=%s AND google_subject=%s AND origin_thread_id=%s
              AND lower(label)=lower(%s) ORDER BY created_at DESC,id DESC''',
            (user['id'], user['google_subject'], self.thread_id,
             self.prepared['label'])).fetchall()
        duplicate = next((row for row in same_label
                          if _normal(row['objective']) == _normal(self.prepared['objective'])), None)
        if duplicate:
            if not focus or focus['assignment_id'] != duplicate['id']:
                return {'ambiguous': True}
            return {'id': duplicate['id'], 'label': duplicate['label'], 'created': False,
                    'focusVersion': focus['version']}
        if same_label:  # Asked at prepare time; this only covers a race.
            return {'ambiguous': True}
        row = c.execute('''INSERT INTO uony_assignments
            (user_id,id,google_subject,origin_request_id,origin_thread_id,label,
             objective,next_step,origin_scope)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,label''',
            (user['id'], uuid4(), user['google_subject'], self.request_id,
             self.thread_id, self.prepared['label'], self.prepared['objective'],
             NEXT_STEP[self.prepared['startingPoint']],
             Jsonb({'productId': None, 'intakeId': None}))).fetchone()
        if focus:
            version = focus['version'] + 1
            c.execute('''UPDATE uony_assignment_focus
                SET assignment_id=%s,previous_assignment_id=%s,version=%s,updated_at=now()
                WHERE user_id=%s AND thread_id=%s AND google_subject=%s''',
                (row['id'], focus['assignment_id'], version, user['id'],
                 self.thread_id, user['google_subject']))
        else:
            version = 1
            c.execute('''INSERT INTO uony_assignment_focus
                (user_id,thread_id,google_subject,assignment_id)
                VALUES(%s,%s,%s,%s)''',
                (user['id'], self.thread_id, user['google_subject'], row['id']))
        return {'id': row['id'], 'label': row['label'], 'created': True,
                'focusVersion': version}


def created_focus(c, user, request_id, thread_id):
    """A completion receipt only while this request's goal is still selected."""
    row = c.execute('''SELECT a.id,f.version FROM uony_assignments AS a
        JOIN uony_assignment_focus AS f ON f.user_id=a.user_id
            AND f.assignment_id=a.id AND f.google_subject=a.google_subject
            AND f.thread_id=%s
        WHERE a.user_id=%s AND a.google_subject=%s AND a.origin_request_id=%s
          AND a.origin_thread_id=%s''',
        (thread_id, user['id'], user['google_subject'], request_id, thread_id)).fetchone()
    return ({'assignmentId': str(row['id']), 'version': row['version']} if row else None)
