# Nexus (0.3)

Objetivo: centro transversal de integraciones y proveedores (WhatsApp, correo, voz, SMS, sistemas externos). El Centro de Agentes consume conexiones gestionadas aquí; Nexus no sustituye permisos ni credenciales de cada aplicación.

## Fuente del frontend

Código editable **solo** en Platform: `frontend/modules/0-uonify/0.3-nexus/`. La entrada DEV estática es `nexus-web/index.html`.

Infrastructure (`mastererp-infrastructure/modules/0-uonify/0.3-nexus`) conserva hosting S3, CloudFront, DNS, certificado ACM y rol OIDC de publicación. **No** almacenar HTML, CSS, JS ni builds editables allí.

## Estado actual (DEV)

- Página inicial «Hola mundo» en https://nexus-dev.uonify.com/
- Sin backend, Lambdas, APIs, login ni integraciones activas en esta entrega.

## Ejecución local

```powershell
cd mastererp-platform
node scripts/preview_nexus_frontend.mjs --port 5193
```

Abre http://127.0.0.1:5193/

## Publicación DEV

Workflow: `.github/workflows/publish-nexus-uonify.yml` (rama `dev`, OIDC). Variables del repositorio Platform: `NEXUS_UONIFY_BUCKET`, `NEXUS_UONIFY_DISTRIBUTION_ID` (salidas del stack de hosting).

Stacks AWS (Infrastructure):

- `mastererp-dev-nexus-frontend-certificate` (us-east-1)
- `mastererp-dev-nexus-frontend` (us-west-1)

Scripts de despliegue/verificación en Infrastructure: `scripts/deploy_nexus_frontend.py`, `scripts/verify_nexus_frontend.py`.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../docs/UX_UI_STANDARD.md): Inter local, fondo `#F6F8FC`, superficies blancas, texto `#4B5563`, secundario `#667085`, acentos azules.
<!-- ux-ui-standard:end -->
