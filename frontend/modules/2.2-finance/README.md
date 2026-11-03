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

Finanzas agrupa Administración, Contabilidad, BI y capacidades asociadas. Sus pantallas deben presentarse dentro del espacio general de Uonify (entrada DEV app-dev.uonify.com), con navegación, identidad y contexto comunes y apertura desde el menú sin usar obligatoriamente el chat. Mantiene componentes, build, pipeline, despliegue y rollback propios. La integración técnica, rutas internas y enlaces directos están pendientes: no se fija `/finanzas` como entrada independiente ni se exige crear finanzas.uonify.com en producción. Administración no tiene frontend/subdominio separado. Ver [contrato oficial](../../../docs/FRONTEND_ARCHITECTURE.md).

## Página inicial pública DEV

Aplicación mínima en esta raíz propietaria, sin pantallas nuevas, login, APIs, datos ni operaciones de negocio. Entrada `index.html`, estilos en `src/style.css`; reutiliza Vite con versión fijada y lockfile. `.env.dev` solo contiene la etiqueta pública Desarrollo; nunca introducir secretos en variables VITE_. El frontend completo y la continuidad de sesión/contexto con Uonify siguen pendientes.

```powershell
cd frontend/modules/2.2-finance
npm ci
npm run build
```

Artefacto: `dist/`, no versionado. Node 24 en CI. Configuración por modo Vite: `npm exec -- vite build --mode <ambiente>`; solo DEV está configurado y autorizado. No crea QA/PROD. No se necesita servidor ni dependencias runtime en hosting.

Publicación propia: `.github/workflows/publish-finance-dev.yml`, al cambiar código/build de esta aplicación en dev o mediante dispatch. Autenticación GitHub OIDC, sin claves AWS. Las variables no secretas FINANCE_DEV_BUCKET y FINANCE_DEV_DISTRIBUTION_ID proceden de outputs del stack propietario de hosting. Publica assets con hash antes del HTML, conserva versiones anteriores y después invalida `/` y `/index.html`. No publica otros módulos.

Destino DEV: https://finanzas-dev.uonify.com. El resultado real y recursos se registran en Infrastructure `modules/2.2-finance/HOSTING.md`. Es un acceso independiente de desarrollo y pruebas, no la navegación objetivo del usuario final. No es obligatorio crear finanzas.uonify.com en producción; la integración de pantallas dentro de Uonify sigue pendiente. Recuperación: revertir únicamente archivos de esta aplicación y publicar dev para reconstruir el artefacto previo; no eliminar stacks ni cambiar DNS. La página pública no acredita autenticación, autorización o capacidades financieras implementadas.
