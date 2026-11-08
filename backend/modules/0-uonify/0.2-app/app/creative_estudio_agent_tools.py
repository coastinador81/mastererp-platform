"""Estudio ADK · WIRING de las herramientas de Uony — INERTE, interruptor APAGADO.

Define QUÉ herramientas ve el MODELO y separa lo que el modelo puede leer de lo que va SOLO a la UI
(cond. 1 del veredicto ADK + D-PROTECCION-INGENIERIA-INVERSA). Con `ESTUDIO_TOOLS_ENABLED = False` es
INERTE: no cambia nada del Uony en producción. NO registra nada en el agente: la línea que mete estas
herramientas en uony_adk_agent.py (y engancha el after_tool_callback) se coordina con interfaz DESPUÉS
de congelar lote 8 + el parche _last_config (lote 9). Este módulo solo declara el contrato del wiring.

Cond. 1a (crítica): `confirmar_creacion` NO está en el toolset del modelo — es RUTA DEL CLIENTE; el
modelo no puede gastar porque no tiene herramienta para ello. Cond. 1b (higiene): el token
(`clientConfirmation`) y cualquier clave solo-UI se separan del function-response que lee el modelo.
"""
import re

from .creative_google_capabilities import ModelId
from .creative_estudio_elements import listar_elementos
from .creative_estudio_spend import cotizar_estudio, estado_estudio
from .products import fail
# confirmar_creacion se importa a propósito SOLO para la ruta del cliente, NO como herramienta del
# modelo (ver MODEL_TOOLS): el gasto lo dispara un acto real del cliente, nunca el modelo.
from .creative_estudio_spend import confirmar_creacion  # noqa: F401  (ruta del cliente, no herramienta)

# Interruptor: APAGADO. El wiring es inerte hasta que interfaz lo active tras el freeze.
ESTUDIO_TOOLS_ENABLED = False

# Herramientas que VE EL MODELO (todas solo-lectura o proponer; NINGUNA gasta). confirmar_creacion
# queda FUERA a propósito (cond. 1a). cotizar propone (emite token a la UI, no gasta).
MODEL_TOOLS = {
    'cotizar_estudio': cotizar_estudio,
    'estado_estudio': estado_estudio,
    'listar_elementos': listar_elementos,
}

# Herramientas de RUTA DEL CLIENTE (nunca en el toolset del modelo): gastan / publican con un acto real
# del cliente verificado en servidor.
CLIENT_ROUTE_TOOLS = {
    'confirmar_creacion': confirmar_creacion,
}

# Claves que, si aparecen en el resultado de una tool, van SOLO a la UI, jamás al contexto del modelo.
_UI_ONLY_KEYS = ('clientConfirmation',)


def split_model_and_ui(tool_result):
    """Cond. 1b: separa el resultado de una tool en (lo-que-ve-el-modelo, lo-que-va-SOLO-a-la-UI). El
    after_tool_callback del agente usará esto para que el token (`clientConfirmation`) NO entre en el
    function-response que lee el modelo. Devuelve (model_view, ui_payload)."""
    if not isinstance(tool_result, dict):
        return tool_result, {}
    ui = {k: tool_result[k] for k in _UI_ONLY_KEYS if k in tool_result}
    model_view = {k: v for k, v in tool_result.items() if k not in _UI_ONLY_KEYS}
    return model_view, ui


# GUARD de salida (D-PROTECCION-INGENIERIA-INVERSA, belt-and-suspenders sobre las proyecciones card-safe,
# recomendado por el Consultor; NO es Model Armor). Caza fugas de datos INTERNOS en lo que lee el modelo
# o va al navegador. PRECISO como el guard H8: apunta a los IDS CRUDOS exactos del catálogo (NO las
# etiquetas), sha256 (64 hex) y rutas gs://. googleName ('Veo 3.1 Fast'), maxEur (€) y los handles
# (quoteId/approvalId, uuid de 36) PASAN. El USD y el project-id los quita la proyección card-safe (un
# número/str no se puede distinguir sin falsos positivos); el test estilo H8 lo asegura por clave.
_RAW_MODEL_IDS = frozenset(m.value for m in ModelId)   # fuente única: el catálogo
# sha256 insensible a mayúsculas: una proyección podría serializar el hash en mayúsculas (endurecimiento
# diferido, confirmado por interfaz 22-10).
_SHA256 = re.compile(r'[0-9a-fA-F]{64}')
_GCS = re.compile(r'gs://')


def _leak(value):
    if isinstance(value, str):
        if any(mid in value for mid in _RAW_MODEL_IDS):
            return 'raw_model_id'
        if _SHA256.search(value):
            return 'sha256'
        if _GCS.search(value):
            return 'gcs_uri'
        return None
    if isinstance(value, dict):
        # Escanea CLAVES y valores: un gs://, un id crudo o un sha256 podría colarse como clave de dict
        # (endurecimiento diferido, confirmado por interfaz 22-10).
        return next((h for h in map(_leak, (*value.keys(), *value.values())) if h), None)
    if isinstance(value, (list, tuple)):
        return next((h for h in map(_leak, value) if h), None)
    return None


def guard_model_output(model_view):
    """Rechaza FAIL-CLOSED si una respuesta model-facing lleva un id de modelo CRUDO, un sha256 o una
    ruta gs://. Defensa secundaria; la primaria son las proyecciones card-safe. El error es genérico
    (regla 1: nada de trazas al cliente)."""
    if _leak(model_view):
        fail('creative_output_internal_leak', 'No se pudo preparar la respuesta.', 500)
    return model_view


def prepare_tool_result(tool_result):
    """after_tool_callback: (a) separa el token/solo-UI y (b) aplica el guard de salida al model_view.
    Devuelve (model_view_para_el_modelo, ui_payload_para_la_UI)."""
    model_view, ui = split_model_and_ui(tool_result)
    guard_model_output(model_view)
    return model_view, ui


def model_tool_names():
    """Los nombres de herramienta que el agente puede exponer al modelo (confirmar_creacion NO está)."""
    return tuple(MODEL_TOOLS)


def estudio_model_tools(declarations=None, estudio_dispatch=None):
    """ON-case: envuelve las herramientas del Estudio del MODELO (cotizar/estado/listar; confirmar
    NUNCA) como tools de ADK. INERTE hoy: make_agent solo la llama con ESTUDIO_TOOLS_ENABLED (hoy False;
    apagado usa `[]`). Este es «el punto del canal hacia la UI» donde el wiring se detiene: las DOS
    costuras las aporta interfaz AL ACTIVAR, y sin ellas la función se niega (no adivina ni el esquema ni
    el canal):
      - `declarations`: el esquema model-facing FINALIZADO de las tres herramientas (nombre/descripción/
        parameters). Depende del modelo de plan/pieza de ArtCraft (migración 135) y de la UX del dueño.
      - `estudio_dispatch(name, args, tool_context)` (corutina): la costura de contexto del agente —
        inyecta conexión/usuario y ejecuta la herramienta; su resultado {card, clientConfirmation} lo
        separa `estudio_after_tool_callback` (el token va a tool_context.state['estudio_ui_payload'], de
        ahí al canal de la UI que construye interfaz). El modelo solo ve `card`.
    Cond. 1a (invariante de seguridad, se valida aquí): NINGUNA declaración puede ser una herramienta de
    RUTA DEL CLIENTE (confirmar_creacion) ni una desconocida; solo las de MODEL_TOOLS. Patrón idéntico a
    `_BusinessTool` del agente (declaración → BaseTool que delega el despacho)."""
    if declarations is None or estudio_dispatch is None:
        raise NotImplementedError(
            'estudio_model_tools requiere (declarations, estudio_dispatch): el esquema model-facing '
            'finalizado del Estudio y la costura de despacho/contexto del agente con el canal de token a '
            'la UI. Los aporta interfaz al activar ESTUDIO_TOOLS_ENABLED (plan de ArtCraft + UX del dueño).')
    names = [d.get('name') for d in declarations]
    if any(n in CLIENT_ROUTE_TOOLS for n in names):
        fail('estudio_wiring_client_route_tool',
             'Una ruta del cliente no puede exponerse como herramienta del modelo.', 500)
    if any(n not in MODEL_TOOLS for n in names):
        fail('estudio_wiring_unknown_tool', 'Herramienta del Estudio desconocida en el wiring.', 500)
    # Importes de ADK EN DIFERIDO: el módulo y el guard no dependen de ADK hasta que se ACTIVA.
    from google.adk.tools.base_tool import BaseTool
    from google.genai import types
    from pydantic import PrivateAttr

    class _EstudioTool(BaseTool):
        """Envuelve una declaración del Estudio y delega en la costura de despacho del agente (interfaz).
        El resultado pasa por estudio_after_tool_callback, que deja al modelo solo el card card-safe."""
        _dispatch = PrivateAttr()

        def __init__(self, declaration, dispatch):
            super().__init__(name=declaration['name'], description=declaration.get('description', ''))
            self.declaration = types.FunctionDeclaration.model_validate(declaration)
            self._dispatch = dispatch

        def _get_declaration(self):
            return self.declaration

        async def run_async(self, *, args, tool_context):
            return await self._dispatch(self.name, args, tool_context)

    return [_EstudioTool(d, estudio_dispatch) for d in declarations]


def estudio_after_tool_callback(tool, args, tool_context, tool_response):
    """after_tool_callback de ADK (firma _SingleAfterToolCallback de ADK 2.12.0:
    (BaseTool, dict, ToolContext, dict) -> Optional[dict]). Para las herramientas del Estudio: separa el
    token (solo-UI) a tool_context.state, aplica el guard de salida y DEVUELVE al modelo SOLO la vista
    card-safe. Para cualquier otra herramienta devuelve None (no cambia el flujo actual). Solo se
    engancha con el interruptor ENCENDIDO; apagado, make_agent pasa None y el agente se comporta igual."""
    if getattr(tool, 'name', None) not in MODEL_TOOLS:
        return None
    model_view, ui = prepare_tool_result(tool_response)
    if ui:
        try:
            tool_context.state['estudio_ui_payload'] = ui
        except Exception:
            pass
    return model_view
