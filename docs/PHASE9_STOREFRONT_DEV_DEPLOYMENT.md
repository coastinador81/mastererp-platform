# Evidencia de publicación Storefront DEV — Fase 9

Fecha: 2026-11-06. Publicación manual autorizada del corte visual y multitenant
de `frontend/storefront-web`. No se modificaron DNS, Cognito, APIs ni datos.

## Destino verificado

- Cuenta propietaria AWS: `941751053509`.
- Región S3/stack: `us-west-2`.
- Bucket versionado: `tmi-dev-client`.
- Distribución CloudFront: `E2PLU72V9YKM01`.
- Dominio/alias: `https://tienda-dev.tumandaito.com`.
- Origen confirmado: `tmi-dev-client.s3.us-west-2.amazonaws.com`.

La distribución histórica no aparecía en la cuenta MasterERP
`277352717693`; permanece correctamente en la cuenta origen de Tumandaito.

## Procedimiento y rollback

El build se generó con `npm run build:dev` después de aprobar typecheck, lint y
validación estructural. Antes de sustituir la entrada se copió el índice previo
a:

```text
s3://tmi-dev-client/mastererp-phase9-rollback/index-before-c23fc2c.html
```

Se publicaron primero assets con caché inmutable y después `/auth/callback` e
`index.html` con `no-cache`. No se usó `--delete`, por lo que los assets
anteriores permanecen recuperables. La invalidación
`I502B0SYBWGXY9ZA36IAJCFGG1` finalizó correctamente.

## Smoke posterior

- `/`: HTTP 200, `text/html`.
- bundle de entrada: HTTP 200, `text/javascript`.
- SHA-256 local y publicado de `index.html`:
  `745ecfa6fece38f0b58c28cfa326ecb59adf0ad0a14afbd3041590ffe4daf85a`.
- catálogo canónico: HTTP 200, tienda `Supermercado Central`, 11 categorías y
  17 productos disponibles.
- dominio Storefront desconocido: HTTP 404 en la prueba previa.

La captura automatizada del dominio publicado no se ejecutó porque el entorno
rechazó una nueva sesión gráfica por límite de uso. La revisión visual manual
del propietario continúa siendo puerta de aprobación.

## Riesgo pendiente de cutover

El publicador legacy fue retirado de
`tumandaito-frontends/.github/workflows/publish-dev.yml` en el commit `5861a87`.
También se desactivó el job manual equivalente de Infrastructure en `cf9bfed`.
Admin y Landing conservan sus publicaciones; `customer-app` ya no puede
sobrescribir automáticamente `tmi-dev-client`.

La automatización nueva debe usar un rol OIDC de permisos mínimos en la cuenta
propietaria. No se copiarán access keys legacy al repositorio MasterERP.
