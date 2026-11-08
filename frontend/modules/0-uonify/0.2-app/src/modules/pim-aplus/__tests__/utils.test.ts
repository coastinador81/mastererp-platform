import { describe, expect, it } from 'vitest';
import { formatFromUrl, imageDimensionErrors, imageFileErrors } from '../model/imageRules';
import { base64ToBytes, bytesToBase64, hexToBase64, md5Hex } from '../model/md5';
import { editorToPlainText, formatBodyTextForEditor } from '../model/richText';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('MD5 (spark-md5 del original)', () => {
  it('coincide con los vectores conocidos', () => {
    expect(md5Hex(bytes(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(bytes('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
    // Varios bloques de 64 bytes
    expect(md5Hex(bytes('1234567890'.repeat(8)))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('pasa el MD5 a base64 y los bytes a base64 y de vuelta', () => {
    expect(hexToBase64('900150983cd24fb0d6963f7d28e17f72')).toBe('kAFQmDzST7DWlj99KOF/cg==');
    const data = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(data)))).toEqual(Array.from(data));
  });
});

describe('normas de imagen', () => {
  it('formato, peso y medidas con los mensajes del original', () => {
    expect(imageFileErrors('image/png', 1000)).toEqual([]);
    expect(imageFileErrors('image/gif', 2.5 * 1024 * 1024)).toEqual(['Formato no permitido. Use .jpg, .png o .bmp', 'El archivo excede 2MB (actual: 2.5MB)']);
    expect(imageDimensionErrors({ width: 219, height: 400 }, 220, 220)).toEqual(['Imagen muy pequeña. Mínimo: 220x220px (actual: 219x400px)']);
    expect(formatFromUrl('/a/b.JPG?x=1')).toBe('image/jpeg');
    expect(formatFromUrl('/a/b.webp')).toBe('image/webp');
  });
});

describe('editor del cuerpo (A05)', () => {
  const area = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };

  it('conserva los saltos de línea de <br> y de los bloques', () => {
    expect(editorToPlainText(area('Hola<br>mundo'))).toBe('Hola\nmundo');
    expect(editorToPlainText(area('Uno<div>Dos</div><div>Tres</div>'))).toBe('Uno\nDos\nTres');
    expect(editorToPlainText(area('<b>Negrita</b> y más<br>'))).toBe('Negrita y más');
  });

  it('pinta el texto escapado con sus saltos', () => {
    expect(formatBodyTextForEditor('<b>1</b>\n2')).toBe('&lt;b&gt;1&lt;/b&gt;<br>2');
    expect(formatBodyTextForEditor('')).toBe('');
    const text = 'Línea 1\nLínea 2';
    expect(editorToPlainText(area(formatBodyTextForEditor(text)))).toBe(text);
  });
});
