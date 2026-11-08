// Portada de «the eight tabs use only the brand tokens of core.css» (tests/pim-core.test.cjs):
// la parte de los tokens del núcleo, más la regla de la casa de 500 líneas.
// Vitest no carga CSS (css: false) y el proyecto no incluye los tipos de Node:
// se lee del disco con node:fs importado dinámicamente y tipado aquí.
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}
const nodeFs = (): Promise<NodeFs> => import(/* @vite-ignore */ ['node', 'fs'].join(':')) as Promise<NodeFs>;
const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const stylesDir = `${root}/src/shared/ui/styles/`;
let tokens = '';
let sheets: string[] = [];

beforeAll(async () => {
  const fs = await nodeFs();
  tokens = fs.readFileSync(`${root}/src/shared/styles/tokens.css`, 'utf8');
  sheets = fs.readdirSync(stylesDir).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(stylesDir + name, 'utf8'));
});

describe('hojas del kit', () => {
  test('los tokens del manual siguen en tokens.css (aqua nunca es texto sobre claro)', () => {
    expect(tokens).toMatch(/--pim-ai-text: #008376;/);
    expect(tokens).toMatch(/--pim-r-tag: 4px; --pim-r-control: 8px; --pim-r-card: 12px; --pim-r-modal: 16px;/);
  });

  test('conservan las clases pim-* del prototipo y no pasan de 500 líneas', () => {
    const texts = sheets;
    expect(texts.length).toBeGreaterThanOrEqual(6);
    texts.forEach(text => expect(text.split('\n').length).toBeLessThanOrEqual(500));
    const all = texts.join('\n');
    [
      '.pim-btn-primary', '.pim-btn-ai', '.pim-btn-icon', '.pim-badge-ai', '.pim-card-dashed', '.pim-select',
      '.pim-switch', '.pim-check', '.pim-progress-ai', '.pim-subtabs', '.pim-dropzone', '.pim-spin', '.pim-empty',
      '.pim-alert-amber', '.pim-toaster', '.pim-toast-loading', '.pim-dialog-xl', '.pim-head', '.pim-toolbar',
      '.pim-meta', '.pim-kv', '.pim-stepper', '.pim-thumb-actions', '.pim-option', '.pim-ai-mark', '[data-tooltip]',
    ].forEach(selector => expect(all).toContain(selector));
    expect(all).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(all).toMatch(/:root\[data-tooltips-hidden\] \[data-tooltip\]::after/);
  });
});
