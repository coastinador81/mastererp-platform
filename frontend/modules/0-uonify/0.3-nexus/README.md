# Nexus

Código: `0.3`.

Responsabilidad: interfaz independiente para Nexus, el plano transversal que administrará conexiones configuradas y disponibles para módulos autorizados.

Estado: primera pantalla estática «Hola mundo Nexus». No consume API, no gestiona credenciales, no conserva datos ni declara permisos.

Propietario: Platform frontend. Correspondencia: `backend/modules/0-uonify/0.3-nexus` y `modules/0-uonify/0.3-nexus` en Infrastructure y Database.

Dependencias: ninguna en este incremento. La configuración de conexiones y la publicación en `nexus-dev.uonify.com` requieren contratos y recursos separados.
