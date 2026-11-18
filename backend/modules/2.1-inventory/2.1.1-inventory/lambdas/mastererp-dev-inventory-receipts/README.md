# mastererp-dev-inventory-receipts

Read-only adapter for validating purchase-order records through the controlled
`administracion.purchase_read` database function. It does not create receipts
or modify inventory. The current purchase contract exposes drafts only and
does not link lines to Catalog products, so orders remain ineligible for stock
receipt until Finance defines issuance and product linkage and Inventory adds
receipt tracking.
