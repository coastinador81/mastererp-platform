# Pantallas compartidas de compras

Responsabilidad: listado, detalle, creación y edición de borradores de solicitudes, órdenes y facturas de proveedor, reutilizando una implementación visual y la Lambda Compras existente.

Frontend implementa las pantallas; Backend enruta en la Lambda propietaria de Gestión de compras; Database reutiliza documentos y comandos controlados. Infrastructure no declara recursos exclusivos para esta pantalla: resources.yml vacío y excluido del despliegue.

Estado: borradores básicos implementados y validados por HTTP/navegador en DEV; efectos financieros y aprobación pendientes. Ver [contrato y evidencia](../../../../../../../docs/PURCHASE_DRAFTS_DEV.md).

## Harness local de validación visual (aislado)

Para revisar `Purchases.jsx` sin usar la app con autenticación real: en `frontend/modules/2.2-finance` ejecutar `npm run dev:harness`, abrir en el navegador `http://127.0.0.1:5173/purchases-harness.html` (el puerto lo indica la consola de Vite) y usar los atajos numerados. Los datos ficticios viven en `purchasesDemoFixtures.mjs` (escenario **Catálogo demo**: solicitudes, órdenes y facturas enlazadas). El mock intercepta solo el harness; no altera Cognito ni la app productiva.
