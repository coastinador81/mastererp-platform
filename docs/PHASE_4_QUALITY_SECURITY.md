# Fase 4 — Pruebas, calidad y seguridad

## Controles implementados

`Quality and security` se ejecuta en cada pull request y cada cambio a `dev`,
sin credenciales AWS y sin pasos de despliegue. Cubre handlers, repositorios
simulados, reglas de dominio, autorización, aislamiento de tenant,
idempotencia, concurrencia y auditoría mediante pruebas unitarias existentes.
Exige un mínimo de 60 % de cobertura de líneas para el conjunto Python y
compila el backend como análisis estático básico. También ejecuta la prueba de
autenticación de frontend y los builds de Uonify, Finanzas y Storefront.

El workflow de calidad no recibe credenciales AWS ni contiene pasos de
publicación. Los workflows de despliegue DEV ya existentes se mantienen fuera
de este control para no alterar integraciones activas.

## Límites verificados

La implementación actual usa PostgreSQL/RDS y no contiene plantillas SAM,
contratos OpenAPI ni recursos DynamoDB. Por ello no se ejecutan ni se reportan
como aprobados `sam validate --lint`, pruebas de contrato OpenAPI/SAM, ni
integración contra DynamoDB. Incorporarlos exige primero una plantilla o
contrato propietario y una decisión de arquitectura; esta fase no crea una
fachada ficticia de esos recursos.

Las pruebas de integración de onboarding que usan una base de datos están
marcadas como `integration` y se excluyen de CI hasta contar con una base
desechable autorizada. El workflow no usa RDS DEV ni AWS DEV, evitando alterar
datos compartidos durante la Fase 4.

## Evidencia requerida para cierre

El cierre de la fase requiere una ejecución verde del workflow y conservar el
artefacto de cobertura de esa ejecución. La evidencia local debe incluir:

```text
python -m pytest ... -m "not integration"
node --test frontend/shared/auth/cognito.test.mjs
python scripts/validate_structure.py
git diff --check
```
