// Portado de tests/pim-core.test.cjs: «the eight tabs use only the brand tokens of core.css
// (no stray colours)», para la hoja de esta pestaña. Vitest no carga CSS (css: false) y el
// proyecto no incluye los tipos de Node: se lee del disco con node:fs importado dinámicamente.
export {};

interface NodeFs { readFileSync(path: string, encoding: 'utf8'): string }
const nodeFs = (): Promise<NodeFs> => import(/* @vite-ignore */ ['node', 'fs'].join(':')) as Promise<NodeFs>;
const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
let css = '';

beforeAll(async () => {
  const fs = await nodeFs();
  css = fs.readFileSync(`${root}/src/modules/pim-atributos/styles/atributos.css`, 'utf8');
});

describe('hoja de la pestaña atributos', () => {
  test('solo usa los tokens de marca: sin colores sueltos ni degradados decorativos', () => {
    // Un relleno plano escrito como linear-gradient(x, x) es el truco padding-box del borde degradado de la IA.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/linear-gradient\((var\(--pim-[a-z-]+\)), \1\)/g, 'FLAT');
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bare).not.toMatch(/linear-gradient\((?![^)]*var\(--pim-ai-gradient)/);
  });

  test('conserva el prefijo de clases del prototipo y no pasa de 500 líneas', () => {
    expect(css.split('\n').length).toBeLessThanOrEqual(500);
    const classes = [...css.matchAll(/\.(pim-[a-z0-9-]+)/g)].map(match => match[1]);
    expect(classes.some(name => name.startsWith('pim-atributos'))).toBe(true);
  });
});
