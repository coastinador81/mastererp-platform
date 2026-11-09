# Nexus

Código: `0.3`.

Responsabilidad: interfaz independiente para Nexus, el plano transversal que administrará conexiones configuradas y disponibles para módulos autorizados.

Estado: primera pantalla estática «Hola mundo Nexus». No consume API, no gestiona credenciales, no conserva datos ni declara permisos.

Propietario: Platform frontend. Correspondencia: `backend/modules/0-uonify/0.3-nexus` y `modules/0-uonify/0.3-nexus` en Infrastructure y Database.

Dependencias: ninguna en este incremento. La infraestructura de hosting DEV está definida en `mastererp-infrastructure/modules/0-uonify/0.3-nexus`; su despliegue y la publicación del artefacto siguen pendientes. La configuración de conexiones requiere contratos separados.
