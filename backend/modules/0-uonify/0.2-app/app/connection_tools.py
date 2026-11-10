"""Controles conocidos de conexión; mostrarlos nunca concede ni revoca permisos."""

PROVIDERS = {'amazon': 'Amazon', 'cloud': 'Google Cloud', 'drive': 'Google Drive', 'blender': 'Blender local',
             'erp': 'ERP · Finanzas'}
# Clave de cada proveedor en el estado de la cuenta; la del ERP la pone el worker (observe).
STATUS_KEYS = {'amazon': 'amazonConnection', 'cloud': 'googleCloud', 'drive': 'drive', 'blender': 'blenderLocal',
               'erp': 'erp'}
AMAZON_ACTION = {'provider': 'amazon', 'action': 'manage'}
DECLARATIONS = [{
    'name': 'show_amazon_connection',
    'description': 'Muestra en esta conversación una tarjeta para gestionar Amazon. No modifica permisos; el usuario controla las acciones desde la tarjeta.',
    'parameters': {'type': 'OBJECT', 'properties': {}},
}, {
    'name': 'show_account_deletion',
    'description': 'Muestra en esta conversación el control para eliminar la cuenta propia de Uonify. No elimina datos ni concede autorización: la persona debe revisar y confirmar en la interfaz.',
    'parameters': {'type': 'OBJECT', 'properties': {}},
}, {
    'name': 'show_connection',
    'description': 'Muestra controles reales de conexión en esta conversación para Amazon, Google Cloud, Google Drive, Blender local o ERP · Finanzas. No conecta, desconecta ni concede permisos.',
    'parameters': {'type': 'OBJECT', 'properties': {'provider': {'type': 'STRING', 'enum': list(PROVIDERS)}}, 'required': ['provider']},
}]


class ConnectionActions:
    def __init__(self, status=None):
        self._providers = []
        self._account_deletion = False
        self._statuses = status if isinstance(status, dict) else {'amazonConnection': status}

    def observe(self, key, status):
        """Estado que el de la cuenta no trae (el del ERP, en el worker): un valor o una función
        que solo se consulta al mostrar la tarjeta."""
        self._statuses = {**self._statuses, key: status}

    def show_amazon(self, args):
        if not isinstance(args, dict) or args:
            return {'error': 'invalid_tool', 'message': 'Esta herramienta no admite argumentos.'}
        return self.show({'provider': 'amazon'})

    def show_account_deletion(self, args):
        if not isinstance(args, dict) or args:
            return {'error': 'invalid_tool', 'message': 'Esta herramienta no admite argumentos.'}
        self._account_deletion = True
        return {'prepared': True, 'connectionAction': {'provider': 'account', 'action': 'manage'},
                'message': 'Se mostrará el control real para eliminar la cuenta propia. Mostrarlo no elimina nada. El usuario revisa el alcance y confirma expresamente en la interfaz; nunca afirmes que la cuenta ya está eliminada ni uses ask_user para autorizar el borrado.'}

    def show(self, args):
        if not isinstance(args, dict) or set(args) != {'provider'} or not isinstance(args['provider'], str) or args['provider'] not in PROVIDERS:
            return {'error': 'invalid_tool', 'message': 'Selecciona una conexión disponible.'}
        provider = args['provider']
        if provider not in self._providers:
            self._providers.append(provider)
        raw = self._statuses.get(STATUS_KEYS[provider])
        if callable(raw):
            raw = raw()
        if isinstance(raw, dict):
            raw = raw.get('status')
        status = raw if raw in ('connected', 'disconnected', 'reauthorize', 'offline', 'online') else 'unknown'
        primary = 'Gestionar conexión' if status in ('connected', 'online', 'offline') else 'Volver a autorizar' if status == 'reauthorize' else 'Conectar ' + PROVIDERS[provider] if status == 'disconnected' else None
        return {
            'prepared': True,
            'connectionAction': {'provider': provider, 'action': 'manage'},
            'observedConnectionStatus': status,
            'primaryAction': primary,
            'message': 'Presenta brevemente la tarjeta sin afirmar cambios. La interfaz vuelve a consultar el estado real. El usuario controla las autorizaciones y confirma cualquier desconexión; no debe navegar a otro módulo. Permisos externos se confirman en la ventana del proveedor conservando este chat.',
        }

    def present(self):
        return ([{'provider': provider, 'action': 'manage'} for provider in self._providers]
                + ([{'provider': 'account', 'action': 'manage'}] if self._account_deletion else []))
