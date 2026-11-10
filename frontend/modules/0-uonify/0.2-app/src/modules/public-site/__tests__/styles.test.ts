// Vitest no carga CSS (css: false) y el proyecto no incluye los tipos de Node:
// las hojas se leen del disco con node:fs importado dinámicamente (como shared/ui).
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}
const nodeFs = (): Promise<NodeFs> => import(/* @vite-ignore */ ['node', 'fs'].join(':')) as Promise<NodeFs>;
const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const stylesDir = `${root}/src/modules/public-site/styles/`;
/** Hoja del centro de ayuda (módulo help), que también pinta el pie global. */
const helpSheet = `${root}/src/modules/help/components/help.css`;

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
    ['pages/productos.css', 'home/styles.css', 'legal/legal.css', 'site-footer.css'].forEach(path => expect(styles(path)).not.toMatch(/^@import/m));
  });

  test('el pie global trae su propia hoja, solo con tokens, y ninguna otra hoja copia estilos de pie', () => {
    const footer = styles('site-footer.css');
    expect(footer).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(footer).toMatch(/\.site-footer \.site-footer__menu \{/);
    expect(footer).toMatch(/:root\[data-more-contrast="true"\] \.site-footer \{/);
    // Todas las hojas de la web pública (también las que se añadan) y la de Ayuda.
    const views = fs.readdirSync(stylesDir, { recursive: true }).filter(path => path.endsWith('.css') && path !== 'site-footer.css');
    expect(views).toEqual(expect.arrayContaining(['home/styles.css', 'legal/legal.css', 'pages/productos.css', 'pages/sobre-uonify.css']));
    const sheets: Array<[string, string]> = [...views.map((path): [string, string] => [path, styles(path)]), ['help.css', fs.readFileSync(helpSheet, 'utf8')]];
    for (const [path, text] of sheets) {
      const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
      // Ni la clase .footer del prototipo, ni el elemento footer como selector, ni el diálogo «Preferencias».
      expect(css, path).not.toMatch(/\.footer\b|\.preferences?-|#preferences-/);
      expect(css, path).not.toMatch(/(^|[\s,>+~(){};])footer(?![\w-])/);
      // Como mucho, la separación con el contenido; nunca colores ni tipografía del pie.
      expect(css, path).not.toMatch(/\.site-footer[^{]*\{[^}]*(color|background|font|border)/);
    }
  });

  test('la cabecera común trae su propia hoja y ninguna otra hoja (salvo las de la portada) copia estilos de cabecera', () => {
    expect(styles('common/page-header.css')).toMatch(/\.header\.header--row \{/);
    // Todas las hojas de la web pública (también las que se añadan) y la de Ayuda; la portada tiene su cabecera.
    const sheets: Array<[string, string]> = [
      ...fs.readdirSync(stylesDir, { recursive: true })
        .filter(path => path.endsWith('.css') && path !== 'common/page-header.css' && !path.startsWith('home/'))
        .map((path): [string, string] => [path, styles(path)]),
      ['help.css', fs.readFileSync(helpSheet, 'utf8')],
    ];
    expect(sheets.map(([path]) => path)).toEqual(expect.arrayContaining(['common/tools-panel.css', 'legal/legal.css', 'pages/productos.css', 'help.css']));
    for (const [path, text] of sheets) {
      const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
      // Ni la estructura de la cabecera ni sus enlaces (el panel de servicios solo usa .tools-*).
      expect(css, path).not.toMatch(/\.(header--rows|main-nav|nav-row|login-link|header-actions|skip-link)(?![\w-])/);
      if (path === 'common/tools-panel.css') continue;
      // Las vistas, el centro legal y Ayuda: ni .header ni .brand, ni el elemento header al principio de un selector.
      expect(css, path).not.toMatch(/\.(header|brand)(?![\w-])/);
      expect(css, path).not.toMatch(/(^|[{},])\s*header(?![\w-])/);
    }
  });
});

// Módulo propio: sus constantes no chocan con las de otras pruebas.
export {};
