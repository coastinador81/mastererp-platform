# Primer recorrido integrado de Finanzas — DEV

Estado: código preparado, publicación y validación real de navegador en curso. Este archivo registra el mecanismo; los resultados se incorporan después de ejecutar las pruebas. No constituye cierre completo de Finanzas.

## Integración elegida

Composición de código fuente durante el build, con React/Vite existentes. `frontend/app-shell/src/Shell.jsx` importa `frontend/modules/2.2-finance/src/Finance.jsx`, que usa una única pantalla compartida en `2.2.1-administration/screens/parties/Parties.jsx`. El entrypoint de Uonify y el de Finanzas montan ese shell con el mismo módulo. No hay iframe, bundles remotos o pantallas duplicadas. Los iconos y el contrato PKCE se reutilizan del frontend DEV existente. Chat conserva su presentación, con asistente/voz sin conectar.

Finanzas conserva su propio package-lock, build, artefacto Actions, workflow y hosting. Un cambio en sus componentes o en el shell compartido activa ambos workflows; cada artefacto se construye desde el mismo commit. Una versión financiera llega al front general mediante un nuevo build/publicación de Uonify, no por apuntar automáticamente a la última versión remota. Un fallo de pipeline no promociona el otro artefacto implícitamente. Rollback: volver a ejecutar un workflow del commit previo revisado o revertir exclusivamente sus cambios y publicar dev; se conservan assets con hash. El contrato de componentes deberá evolucionar con compatibilidad entre builds.

## Rutas y contexto

Entrada general https://app-dev.uonify.com. Inicio `/#/`, chat `/#/chat`, Finanzas `/#/modulos/finanzas`; Clientes `/#/modulos/finanzas/administracion/clientes` y Proveedores `/#/modulos/finanzas/administracion/proveedores`. Detalle añade `/UUID`, creación `/nuevo`, edición `/UUID/editar`. Son rutas internas implementadas en este recorrido; la entrada independiente `/finanzas` no es obligatoria. Hash/history nativos soportan recarga, enlace directo y atrás/adelante sin fallback SPA de S3. El callback OAuth sigue siendo `/auth/callback`, servido como objeto HTML propio.

Cognito Authorization Code + PKCE y state de un solo uso. Tokens solo en memoria. sessionStorage contiene transacción PKCE, indicador de retorno para recuperar la sesión administrada al recargar y selección candidata de tenant/empresa (solo IDs). Esa selección se revalida contra el servicio; no son permisos ni se comparte automáticamente entre subdominios. Sin tokens en URL, localStorage o logs. Logout limpia memoria/metadatos y UI antes de navegar al proveedor. La caducidad y 401 cierran el contexto; 403 retira datos y permite revalidar. Revisiones de contexto al entrar, cambiar tenant y al recuperar foco/intervalo; solicitudes previas se cancelan y sus resultados se invalidan por generación.

GET existente `/v1/uonify/spaces` mantiene la lista. Query opcional tenant_id añade context con companies, modules y permissions obtenidos por `plataforma.current_frontend_context()` (015), con credenciales de aplicación. Se valida issuer + sub, actor y pertenencia activos. Las empresas listadas respetan la contención por tenant y capability de lectura vigente; no se crea una ACL por empresa. Finanzas solo se presenta si erp.finance está activo y existe administration.parties.read; escritura exige además administration.parties.write. Cada API vuelve a autorizar; el menú y contexto no conceden acceso. Otros módulos sin contrato de pantallas/permisos no se simulan como funcionales.

## Funcionalidad de este recorrido

Listar con cursor (10 registros/página), detalle, crear y editar por empresa; enlazar un tercero existente o añadir el otro rol sin duplicar el maestro. POST conserva Idempotency-Key para reintentar el mismo contenido; PATCH usa la versión del detalle. El 409 requiere recarga explícita y no sobrescribe cambios concurrentes. Carga, vacío, indisponibilidad, denegación y conflicto tienen estados propios. No hay reglas fiscales, métricas inventadas u otras operaciones financieras. Contabilidad, BI, compras, cartera, tesorería, gastos y MasterPay se identifican como pendientes.

## Publicación y propiedad

Workflows Platform Publish Uonify frontend DEV y Publish Finance frontend DEV con OIDC limitado al repositorio/dev y bucket/distribución propios. Upload de assets con hash, callback e index con Content-Type HTML y no-cache, e invalidación. Sin claves permanentes. Variables UONIFY_DEV_BUCKET/UONIFY_DEV_DISTRIBUTION_ID y FINANCE_DEV_BUCKET/FINANCE_DEV_DISTRIBUTION_ID proceden de los stacks propietarios.

El hosting independiente https://finanzas-dev.uonify.com usa las mismas pantallas para desarrollo. Comparte cliente Cognito con callback/logout explícitamente autorizados. Su CloudFront reenvía `/v1/uonify/*` y `/v1/administration/*` a los IDs existentes ebn01q74hh y qx8nmypdhi: HTTPS, caché desactivada y Authorization/contexto/query reenviados mediante Managed-AllViewerExceptHostHeader. Los mismos servicios verifican JWT y permisos; no es bypass de autenticación. El frontend usa credentials:omit. No se reimporta ni actualiza el API Agent heredado SAM y no se añaden rutas o integraciones. app-dev conserva su CORS autorizado actual.

Cliente Cognito/pool/autorizador conservan IDs; cambio solo en callbacks y logout. Hosting Uonify añade únicamente rol de publicación; Finanzas actualiza su distribución sin reemplazarla. API Gateways, rutas e integraciones preservados. El código Lambda se actualiza mediante `scripts/update_uonify_artifact.py` de Infrastructure, que revisa el change set y verifica IDs/configuración. Dependencias empaquetadas desde ZIP desplegado con SHA verificado por `scripts/package_uonify.py`.

## Procedencia y validación

Se revisaron los archivos locales de autenticación, configuración pública, iconos y entrypoint necesarios que todavía no estaban versionados. No se publica el resto de borradores. La plantilla local de hosting Uonify y la de identidad coincidían con AWS antes de añadir los cambios propios; se versionan esas bases necesarias para reproducibilidad. El handler previo coincide con AWS; el adaptador local difiere solo en el parámetro write=False ya introducido para Clientes/Proveedores (read-only por defecto). El contexto nuevo conserva ese comportamiento de lectura. Baseline Lambda TmA4Mwq3faMxC9S1KPJN3+3Vqr4QyDSaz40Ty6NFnG4=.

RDS: backup mastererp-dev-before-frontend-context-20261104 disponible. 015 aplicada/reaplicada y pruebas como mastererp_app aprobadas por [workflow oficial](https://github.com/eticayservicios/mastererp-database/actions/runs/41850364216). No se reejecutaron SQL 001–014. Docker local no tenía motor Linux disponible; la validación desechable no se declara aprobada. Los tests SQL usan ROLLBACK para fixtures; no revierten la función ya confirmada.

Resultados de navegador y evidencia visual: pendientes de completar tras la publicación; script `scripts/validate_finance_browser.cjs`. Usa cuentas sintéticas existentes, fixtures nuevas qa-parties-* y limpieza acotada por el migrador oficial. No registra credenciales/tokens ni captura la página de login. Los tests de APIs, expiración controlada y UI se identifican por separado.
