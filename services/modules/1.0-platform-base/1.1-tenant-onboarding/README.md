# Tenant Onboarding backend

Responsabilidad: alta de tenant, sesiones, módulos y aprovisionamiento idempotente.

## Estructura

- `tenant_onboarding/services/` — lógica compartida (Uonify reutiliza esta capa).
- `lambdas/*/` — puntos de entrada Lambda (`lambda_handler`).
- `tests/` — unitarias + integración (`MASTERERP_TEST_DATABASE_URL`).

Empaquetado SAM: incluir dependencia editable `packages/tenant-security` en el artefacto o capa Lambda.
