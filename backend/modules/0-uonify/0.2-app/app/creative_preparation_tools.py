"""Herramienta de consulta para Uony; no prepara ni ejecuta proveedores."""

from .creative_preparation_service import get_creative_preparation


DECLARATIONS = [{
    'name': 'get_creative_preparation',
    'description': ('Consulta el estado vigente del plan creativo en este hilo, '
                    'sus bloqueos y si existe un máximo completo. No crea jobs, '
                    'no cotiza, no aprueba y no genera medios.'),
    'parameters': {'type': 'OBJECT', 'properties': {}},
}]


class CreativePreparationTools:
    def __init__(self, database, user, thread_id):
        self.database, self.user, self.thread_id = database, user, thread_id

    def call(self, name, args):
        if name != 'get_creative_preparation' or args != {}:
            return {'error': 'invalid_tool',
                    'message': 'Esta consulta no recibe argumentos.'}
        with self.database.connect() as connection:
            return {'creativePreparation': get_creative_preparation(
                connection, self.user, self.thread_id)}
