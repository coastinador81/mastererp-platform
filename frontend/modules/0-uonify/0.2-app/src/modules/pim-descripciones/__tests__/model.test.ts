import type { PimProduct } from '@/shared/pim';
import { bulletRows, clearBullet, codeValue, displayBulletPoints, filledBullets, keywordsValue, previewHtml } from '../model/content';
import { sanitizeHtml } from '../model/safeHtml';
import { asKeywords, extractSpecifications, stripHtml, textToHtml } from '../model/text';

describe('texto y HTML', () => {
  test('textToHtml convierte párrafos y deja el HTML tal cual', () => {
    expect(textToHtml('Uno\nlínea\n\nDos')).toBe('<p>Uno<br>línea</p>\n<p>Dos</p>');
    expect(textToHtml('<p>Ya es HTML</p>')).toBe('<p>Ya es HTML</p>');
    expect(textToHtml('')).toBe('');
  });

  test('stripHtml no ejecuta nada de lo que analiza', () => {
    const spy = vi.fn();
    (globalThis as unknown as { __hit: () => void }).__hit = spy;
    expect(stripHtml('<img src="x" onerror="__hit()"><b>Hola</b>')).toBe('Hola');
    expect(spy).not.toHaveBeenCalled();
  });

  test('keywords en lista se unen y las especificaciones salen de los atributos', () => {
    expect(asKeywords(['a', 'b'])).toBe('a, b');
    expect(extractSpecifications({ _raw_attributes: { material: [{ value: 'Roble' }], color: 'Azul' }, attributes: { talla: 'M', peso: 3 } }))
      .toEqual(['color: Azul', 'material: Roble', 'talla: M']);
  });
});

describe('vista previa saneada (E04)', () => {
  test('quita scripts, manejadores y enlaces peligrosos; conserva el formato permitido', () => {
    const nodes = sanitizeHtml('<p onclick="x()">Hola <strong>mundo</strong></p><script>alert(1)</script><a href="javascript:alert(1)">mal</a><a href="https://uonify.com" target="_blank">bien</a><img src="data:x"><img src="https://cdn/a.jpg" alt="A"><custom>texto</custom>');
    expect(nodes).toEqual([
      { tag: 'p', attrs: {}, children: ['Hola ', { tag: 'strong', attrs: {}, children: ['mundo'] }] },
      { tag: 'a', attrs: {}, children: ['mal'] },
      { tag: 'a', attrs: { href: 'https://uonify.com', target: '_blank', rel: 'noopener noreferrer' }, children: ['bien'] },
      { tag: 'img', attrs: { src: 'https://cdn/a.jpg', alt: 'A', loading: 'lazy', referrerpolicy: 'no-referrer' }, children: [] },
      'texto',
    ]);
  });

  test('en las tablas no deja texto en blanco entre filas', () => {
    const [table] = sanitizeHtml('<table>\n<tr>\n<td colspan="2">A</td>\n</tr>\n</table>');
    expect(table).toMatchObject({ tag: 'table', children: [{ tag: 'tbody', children: [{ tag: 'tr', children: [{ tag: 'td', attrs: { colspan: '2' }, children: ['A'] }] }] }] });
  });
});

describe('contenido de la pestaña', () => {
  const product: PimProduct = { sku: 'A', name: 'Taza', description: 'Cerámica', bullets: ['Uno', 'Dos'], keywords: 'taza' };

  test('seis filas; sin estado guardado salen las del producto o las de Amazon', () => {
    expect(bulletRows(undefined, product)).toEqual(['Uno', 'Dos', '', '', '', '']);
    expect(filledBullets(undefined, product)).toBe(2);
    const amazon: PimProduct = { sku: 'B', name: 'B', bullets: [], _raw_attributes: { bullet_point: [{ value: 'De Amazon' }] } };
    expect(displayBulletPoints(undefined, amazon)).toEqual(['De Amazon']);
    expect(bulletRows(undefined, null)).toEqual(['', '', '', '', '', '']);
  });

  test('vaciar una fila más allá del final no deja huecos (E11)', () => {
    const next = clearBullet(['Uno'], product, 3);
    expect(next).toEqual(['Uno', '', '', '']);
    expect(Object.keys(next)).toHaveLength(4);
  });

  test('una descripción editada, aunque esté vacía, manda (E02/E05) y el editor no reescribe lo tecleado', () => {
    expect(previewHtml({}, product)).toBe('<p>Cerámica</p>');
    expect(codeValue({}, product)).toBe('<p>Cerámica</p>');
    expect(codeValue({ description: '' }, product)).toBe('');
    expect(codeValue({ description: 'a' }, product)).toBe('a');
    expect(previewHtml({ description: 'a' }, product)).toBe('<p>a</p>');
    expect(keywordsValue({}, product)).toBe('taza');
    expect(keywordsValue({ keywords: ['x', 'y'] }, product)).toBe('x, y');
  });
});
