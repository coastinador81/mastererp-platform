# Temas administrativos: Finanzas y Ecommerce

Propietario técnico: Platform `frontend/shared/ui`. Consumidores activados: Finanzas `2.2-finance` y Ecommerce `2.3-ecommerce`. Solo frontend DEV; no cambia APIs, autorización, datos, hosting ni recursos. Las otras aplicaciones conservan su apariencia mientras no activen explícitamente el contrato.

## Uso y alcance

El icono de tema de la cabecera ofrece **Automático**, **Claro** y **Oscuro**, mediante radios accesibles. Automático sigue `prefers-color-scheme` y reacciona a sus cambios; una elección explícita prevalece. Escape cierra el selector y devuelve el foco; se puede recorrer con teclado. Se adapta la cabecera móvil para mantener visibles las acciones existentes.

La única preferencia almacenada es `uonify.ui.theme` en localStorage: system/light/dark. Se restaura al recargar y se propaga entre pestañas del mismo origen. Una restricción de almacenamiento no impide cambiar el tema de la página. El almacenamiento es independiente en cada subdominio; no se transfieren preferencias, tokens ni contexto por URL, cookies de dominio o datos del tenant. El tema nunca modifica sesión o permisos.

## Implementación

- `application-theme.mjs`: inicialización antes del montaje, resolución, persistencia y eventos. Las entradas de las dos aplicaciones llaman `initializeApplicationTheme()` una vez.
- `application-theme.css`: capa opt-in mediante `data-uon-theme-scope="administration"` y `data-uon-theme="dark"`. El manual corporativo, secciones 10–12 y 15, define tinta #0A0B0D, superficies #14171E/#2B2E35, textos de pasos claros, azul de acción y aqua reservado a IA. No usar filtros de inversión ni alterar imágenes o logotipos.
- `ApplicationThemeToggle.jsx`: selector común en `ApplicationHeader`. La disposición responsive permanece en `application-header.css`.
- Los colores literales de hojas heredadas se envuelven con variables semánticas `--uon-theme-*` y su valor claro original como fallback. Esos tokens solo se activan en oscuro; no se cambia el layout ni se recolorean otros consumidores cuando están ausentes. El nuevo código usa `--uon-surface`, `--uon-neutral-*` y tokens de estado; no copia otra paleta ni añade alias de Finanzas.
- Los alias `--finance-*` existentes se remapean en oscuro por compatibilidad. Launcher y rail reciben referencias explícitas a través de variables heredadas por sus shadow roots.
- Se adaptan superficies de listas, fichas, formularios, tablas, filtros, paneles y diálogos de compras, terceros, ventas, cobros, operaciones, configuración de tienda y catálogo. Los estados conservan texto y sus colores semánticos; no depender exclusivamente del color. La impresión vuelve a papel claro y se oculta el selector. Los generadores PDF no se modifican.

## Validación y publicación

Desde Platform:

```powershell
node --test frontend/shared/ui/application-theme.test.mjs
npm run build --prefix frontend/modules/2.2-finance
npm run build --prefix frontend/modules/2.3-ecommerce
py scripts/validate_structure.py
git diff --check
```

`node scripts/validate_application_theme.cjs <carpeta-de-evidencia-fuera-de-Git>` requiere el Playwright y Chrome existentes. `MASTERERP_PLAYWRIGHT_MODULE` permite indicar su ruta instalada. Monta componentes reales con dobles exclusivamente de prueba, bloquea conexiones externas y no ejecuta escrituras. Comprueba diez vistas de listados/formularios/diálogo, contraste mínimo 4,5:1 en textos y controles activos muestreados, ausencia de superficies blancas, escritorio y móvil (375 px), tema automático, persistencia, teclado, launcher, Uony e impresión. Estas pruebas visuales no acreditan persistencia ni autorización del backend.

Se conserva el valor claro original de las 22 hojas adaptadas: retirar los envoltorios `var(--uon-theme-*,<valor original>)` reproduce su CSS previo, salvo normalización de espacios antes de `:`. Revisar este criterio al mantener compatibilidad.

Publicación mediante los workflows existentes `Publish Finance frontend DEV` y `Publish E-commerce frontend DEV`, con OIDC, builds separados y caché invalidada. Ambos ejecutan las pruebas de preferencias. Los workflows de otros consumidores de componentes compartidos también pueden reconstruirse conforme a sus paths existentes; no se activa el tema en ellos. No hay cambios de backend, SQL, Infrastructure ni Database.

`node scripts/validate_published_theme.cjs <carpeta-fuera-de-Git>` usa la identidad QA y el secreto de validación existentes, solo en memoria, para comprobar el shell publicado con Cognito real. No añade pertenencias ni fixtures y no escribe datos de negocio; no equivale a recorrer todas las operaciones de un usuario final.

Después de publicar, comprobar en ambas URLs la presencia del selector, selección oscuro/claro, preferencia automática, recarga y escritorio/móvil. La comprobación publicada sin sesión solo verifica el shell público y sus menús; distinguirla de las pruebas locales con componentes autorizados y fixtures. Para recuperar, revertir exclusivamente esta entrega y publicar de nuevo con los pipelines propietarios, sin borrar hosting ni datos. La preferencia local puede permanecer almacenada; no contiene datos de negocio.
