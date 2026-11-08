# Inventario

Objetivo general: Administrar existencias, reservas, movimientos, recepciones, conteos y ajustes. Nodos y Preparación se consumirán desde Ecommerce según la decisión del propietario; por ahora nodo representa una sucursal, sin almacenes.

Responsabilidad: Inventario, en la capa frontend/modules. Estado: estructura organizativa; capacidades existentes trasladadas conservando sus contratos.

Dependencias: identidad, autorización y contratos compartidos según el módulo; no crear datos ni recursos duplicados. Propietario funcional: Inventario; responsable nominal pendiente.

UX/UI: consultar el estándar común docs/UX_UI_STANDARD.md desde la raíz. No se implementan funciones por crear esta carpeta.

## Frontend independiente DEV

Base visual y menú en src/, con build propio. Consultar [FRONTEND_BASE.md](FRONTEND_BASE.md) para alcance, Nodos opcional, dependencias y publicación. No reemplaza las capacidades ni contratos existentes.
