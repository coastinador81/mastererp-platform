// Vitest no carga CSS (css: false) y el proyecto no incluye los tipos de Node:
// las hojas se leen del disco con node:fs importado dinámicamente (como shared/ui).
interface NodeFs { readFileSync(path: string, encoding: 'utf8'): string }
const nodeFs = (): Promise<NodeFs> => import(/* @vite-ignore */ ['node', 'fs'].join(':')) as Promise<NodeFs>;
const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const stylesDir = `${root}/src/modules/public-site/styles/`;

let fs: NodeFs;
const styles = (path: string) => fs.readFileSync(stylesDir + path, 'utf8');

beforeAll(async () => { fs = await nodeFs(); });

describe('hojas de la web pública', () => {
  test('la portada da estilo de menú emergente a la lista de esfuerzo (como el PROTO)', () => {
    const css = ['home/styles.css', 'home/v20.css', 'home/flow.css', 'home/testing.css'].map(styles).join('\n');
    expect(css).toMatch(/\.composer-effort-menu \{ position: absolute;|, \.composer-effort-menu \{ position: absolute;/);
    expect(css).toMatch(/\.composer-effort-menu \{[^}]*overflow-y: auto/);
  });

  test('las clases de estado que usan las vistas existen en sus hojas', () => {
    expect(styles('pages/productos.css')).toMatch(/\.marquee-track\.is-paused/);
    expect(styles('pages/productos.css')).toMatch(/\.marquee-track\.is-ready/);
    expect(styles('pages/como-funciona.css')).toMatch(/\.how-toast\{/);
    expect(styles('pages/como-funciona.css')).toMatch(/\[data-active-step="?connect"?\]/);
    expect(styles('pages/para-empresas.css')).toMatch(/\.demo-toast\{/);
    expect(styles('home/testing.css')).toMatch(/:root\[data-more-contrast="true"\] \.composer/);
  });

  test('el marco quita la caja de #root como hacía #page-root', () => {
    expect(styles('frame.css')).toMatch(/#root \{ display: contents; \}/);
  });

  test('ninguna hoja carga fuentes externas por su cuenta (index.html ya trae Inter)', () => {
    ['pages/productos.css', 'home/styles.css', 'legal/legal.css'].forEach(path => expect(styles(path)).not.toMatch(/^@import/m));
  });
});

// Módulo propio: sus constantes no chocan con las de otras pruebas.
export {};
