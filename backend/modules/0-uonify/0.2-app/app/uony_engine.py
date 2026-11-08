"""Select a durable conversation engine without importing optional ADK by default."""
from .uony_provider import UonyProvider

CLASSIC = 'classic'
ADK = 'adk'
ENGINES = frozenset((CLASSIC, ADK))


class EngineUnavailable(Exception):
    """A pinned engine cannot run here; no provider call has started."""


def _load_adk_provider():
    from .uony_adk_agent import AdkAgentProvider
    return AdkAgentProvider()


def adk_enabled_for(settings, user_id=None):
    """Full enablement is reserved for QA; customer pilots are account scoped."""
    return bool(getattr(settings, 'adk_enabled', False) or (
        user_id is not None and
        str(user_id) in getattr(settings, 'adk_pilot_user_ids', ())))


def selected_engine(settings, user_id=None):
    return ADK if adk_enabled_for(settings, user_id) else CLASSIC


def enabled_engines(settings, user_id=None):
    if user_id is not None:
        return (CLASSIC, ADK) if adk_enabled_for(settings, user_id) else (CLASSIC,)
    return (CLASSIC, ADK) if (getattr(settings, 'adk_enabled', False) or
                             getattr(settings, 'adk_pilot_user_ids', ())) else (CLASSIC,)


def supports_streaming(engine, provider, enabled):
    # ADK subclasses UonyProvider but does not accept its stream callbacks.
    return bool(enabled and engine == CLASSIC and type(provider) is UonyProvider)


class EngineProviders:
    def __init__(self, settings, overrides=None):
        self.settings = settings
        self.selected_engine = selected_engine(settings)
        self.adk_enabled = ADK in enabled_engines(settings)
        self._providers = dict(overrides or {})

    def adk_enabled_for(self, user_id):
        return adk_enabled_for(self.settings, user_id)

    def get(self, engine):
        if engine not in ENGINES:
            raise EngineUnavailable('Motor de conversación no reconocido.')
        if engine == ADK and not self.adk_enabled:
            raise EngineUnavailable(
                'El motor ADK está deshabilitado en este ejecutor. La petición conserva su motor y no se cambiará a clásico.'
            )
        if engine not in self._providers:
            if engine == CLASSIC:
                self._providers[engine] = UonyProvider()
            else:
                try:
                    self._providers[engine] = _load_adk_provider()
                except ImportError as exc:
                    raise EngineUnavailable(
                        'El motor ADK fijado para esta petición no está instalado; instala el lock compatible antes de activarlo.'
                    ) from exc
        return self._providers[engine]
