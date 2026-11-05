# Finanzas — frontend principal

Objetivo específico: Coordinar los dominios financieros sin mezclar ejecución operativa.

Responsabilidad: experiencia financiera. Estado: planned.

## Contrato y estado de esta capa

Código: 2.2. Nombre/ruta: `2.2-finance`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Finanzas; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

## Jerarquía de infraestructura

Se conserva la ruta y responsabilidad funcional. La composición Finanzas → Administración y las reservas de Contabilidad/BI se documentan en [docs/FINANCE_HIERARCHY.md](../../../docs/FINANCE_HIERARCHY.md). En Infrastructure, cada recurso permanece en el YAML raíz de su carpeta propietaria; una carpeta no obliga a crear un stack. El resultado AWS se informa por separado en el mapa y evidencia de Infrastructure.

## Navegación y unidad de entrega objetivo

Finanzas agrupa Administración, Contabilidad, BI y capacidades asociadas. Sus pantallas deben presentarse dentro del espacio general de Uonify (entrada DEV app-dev.uonify.com), con navegación, identidad y contexto comunes y apertura desde el menú sin usar obligatoriamente el chat. Mantiene componentes, build, pipeline, despliegue y rollback propios. El primer recorrido usa composición de código en build y rutas hash documentadas en la guía de implementación; no se exige una entrada independiente `/finanzas` ni crear finanzas.uonify.com en producción. Administración no tiene frontend/subdominio separado. Ver [contrato oficial](../../../docs/FRONTEND_ARCHITECTURE.md).

## Primer recorrido DEV (sustituye la página inicial)

Entrada index.html y src/main.js; src/Finance.jsx y pantalla compartida de Clientes/Proveedores bajo Administración. Usa el shell y sesión comunes, APIs reales, selección de empresa y controles de autorización del backend. React/Vite fijados por lockfile, sin secretos. Build independiente y composición en el front general desde el mismo código. Ver [contrato de implementación y evidencia](../../../docs/FINANCE_UI_INTEGRATION.md). Otras operaciones financieras siguen pendientes.

```powershell
cd frontend/modules/2.2-finance
npm ci
npm run build
```

Artefacto: `dist/`, no versionado. Node 24 en CI. Configuración por modo Vite: `npm exec -- vite build --mode <ambiente>`; solo DEV está configurado y autorizado. No crea QA/PROD. No se necesita servidor ni dependencias runtime en hosting.

Publicación propia: `.github/workflows/publish-finance-dev.yml`, al cambiar código/build de esta aplicación en dev o mediante dispatch. Autenticación GitHub OIDC, sin claves AWS. Las variables no secretas FINANCE_DEV_BUCKET y FINANCE_DEV_DISTRIBUTION_ID proceden de outputs del stack propietario de hosting. Publica assets con hash antes del HTML, conserva versiones anteriores y después invalida `/` y `/index.html`. No publica otros módulos.

Destino DEV: https://finanzas-dev.uonify.com. El resultado real y recursos se registran en Infrastructure `modules/2.2-finance/HOSTING.md`. Es un acceso independiente de desarrollo y pruebas, no la navegación objetivo del usuario final. No es obligatorio crear finanzas.uonify.com en producción; la primera integración usa composición de código en build y su validación se registra en la guía enlazada. Recuperación: revertir únicamente archivos de esta aplicación y publicar dev para reconstruir el artefacto previo; no eliminar stacks ni cambiar DNS. El HTML estático no contiene datos de clientes; las operaciones requieren sesión y son autorizadas por API. No se acredita cobertura completa de Finanzas.

## Acabado visual de Finanzas

Tema local en [src/finance.css](src/finance.css), importado solo por la entrada de Finanzas y delimitado por la clase `finance-app` en su HTML. No cambia los estilos compartidos de Uonify. Colores, espacios, radios, alturas y tipografía se centralizan en variables `--finance-*`. Menú blanco, fondo gris azulado, acentos azules y sombras mínimas.

Inter variable se sirve desde el artefacto propio, con fallback sans-serif; fuente, procedencia y licencia en [assets/fonts](src/assets/fonts/README.md). La tabla usa 14 px, peso 400 y #667085, incluidos nombres y códigos; los encabezados usan #F4F7FB y separadores #E8EDF3. El nombre del proveedor conserva su enlace y el clic de fila existente; no se añaden búsquedas, filtros ni operaciones.

Validación local: `node scripts/validate_supplier_row_ux.cjs --finance-theme` desde la raíz de Platform, con Playwright/Chrome disponibles en el entorno existente. El arnés usa los componentes reales con fixtures exclusivamente de prueba, sin llamadas a servicios ni sesión real; las capturas se guardan en `frontend/modules/2.2-finance/node_modules/.cache/finance-visual-ux/`. Ejecutar también el build y el validador estructural. Esta documentación y las capturas locales no acreditan un despliegue en DEV.

Revisión local de este acabado: 20 comprobaciones de navegador aprobadas, incluyendo estilos calculados, carga local de Inter, contraste del texto normal (mínimo 4,57:1 en los estados de tabla), navegación, nueva pestaña, selección de texto, controles, paginación, permisos y menú móvil. No se recibió la imagen de referencia en esta entrega; el acabado sigue las especificaciones textuales. Las capturas usan fixtures exclusivamente de prueba y no datos ni sesión de DEV.
