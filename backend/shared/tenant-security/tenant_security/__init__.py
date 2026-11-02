"""Keep optional database/JWT dependencies lazy; public imports stay compatible."""
from importlib import import_module

_MODULES = {
    "AuthContext": "auth", "resolve_auth": "auth",
    "db_connection": "db", "load_database_secret": "db",
    "HttpError": "http", "api_response": "http", "parse_body": "http",
    "parse_path_params": "http",
}


def __getattr__(name):
    if name not in _MODULES:
        raise AttributeError(name)
    return getattr(import_module(f"tenant_security.{_MODULES[name]}"), name)

__all__ = [
    "AuthContext",
    "HttpError",
    "api_response",
    "db_connection",
    "load_database_secret",
    "parse_body",
    "parse_path_params",
    "resolve_auth",
]
