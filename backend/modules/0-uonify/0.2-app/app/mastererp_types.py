"""Tipos compartidos de la conexión con ERP · Finanzas (contrato entre conexión, cliente HTTP,
herramientas de Uony y rutas de las pantallas). El token solo vive aquí, en memoria del servidor:
nunca en el estado de ADK, el prompt, los logs, las URL ni el navegador (Consultor C4)."""
from dataclasses import dataclass, field
from typing import Callable

# Colección de la API (/v1/administration/<ruta>) por tipo de documento de Uonify.
COLLECTIONS = {
    'compras': 'compras/solicitudes',
    'ordenes': 'compras/ordenes',
    'facturas': 'compras/facturas',
    'proveedores': 'proveedores',
    'clientes': 'clientes',
    'ventas': 'ventas',
}

# Códigos de fallo tipados. Ninguno lleva token, sub, inquilino, empresa ni cuerpos de la API.
ERP_ERROR_CODES = frozenset({
    'erp_reconnect',            # 401, invalid_grant, sin conexión o caducada: tarjeta para reconectar
    'erp_not_linked',           # 403 identity_not_linked: la identidad no está dada de alta en el ERP
    'erp_denied',               # 403 access_denied o api_scope_required: sin permiso para ese apartado
    'erp_not_found',            # 404: no existe o no es visible en la empresa
    'erp_selection_required',   # falta elegir espacio o empresa
    'erp_unavailable',          # 5xx, tiempo agotado o respuesta con forma inesperada
    'erp_invalid',              # 400 o argumentos que no valen
    'erp_changed',              # la conexión cambió durante el turno (huella distinta)
})


class ErpError(Exception):
    def __init__(self, code: str):
        if code not in ERP_ERROR_CODES:
            code = 'erp_unavailable'
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ErpCredential:
    """Lo que necesita una llamada de servidor a servidor. La huella es sha256 de
    refresh_encrypted: identifica la versión de la conexión y se recomprueba al cerrar el turno."""
    access_token: str = field(repr=False)
    tenant_id: str = field(repr=False)
    company_id: str = field(repr=False)
    fingerprint: str = field(repr=False)


# Proveedor de credencial ligado a un usuario: lo crea el servidor y llega a las herramientas por
# closure. Lanza ErpError('erp_reconnect' | 'erp_selection_required' | 'erp_not_linked').
CredentialProvider = Callable[[], ErpCredential]
