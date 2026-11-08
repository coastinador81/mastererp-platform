import { arLinks, drawARFrame, nextARTab } from '../model/ar';
import { DEFAULT_AR_SETTINGS } from '../model/constants';

function fakeContext() {
  const calls: string[] = [];
  const texts: string[] = [];
  const record = (name: string) => () => { calls.push(name); };
  return {
    calls,
    texts,
    context: {
      filter: 'none',
      fillStyle: '' as unknown,
      strokeStyle: '' as unknown,
      lineWidth: 1,
      font: '',
      drawImage: record('drawImage'),
      save: record('save'),
      restore: record('restore'),
      translate: record('translate'),
      rotate: record('rotate'),
      fillRect: record('fillRect'),
      strokeRect: record('strokeRect'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      fillText: (text: string) => { texts.push(text); },
      createLinearGradient: () => ({ addColorStop: () => {} }),
    },
  };
}

describe('Vista AR', () => {
  test('pestañas con flechas, Inicio y Fin', () => {
    expect(nextARTab('qr', 'ArrowRight')).toBe('camera');
    expect(nextARTab('qr', 'ArrowLeft')).toBe('preview');
    expect(nextARTab('camera', 'Home')).toBe('qr');
    expect(nextARTab('qr', 'End')).toBe('preview');
    expect(nextARTab('qr', 'Enter')).toBeNull();
  });

  test('enlace AR con el nombre en base64 UTF-8 y su código QR', () => {
    const { arUrl, qrSrc } = arLinks('Make It Possible · Año', 42);
    expect(arUrl).toMatch(/^https:\/\/uonify\.com\/ar\/[A-Za-z0-9+/=]+-42$/);
    expect(qrSrc).toBe(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(arUrl)}`);
  });

  test('fotograma simulado: cubo, cuadrícula, ejes y ficha con la escala', () => {
    const { context, calls, texts } = fakeContext();
    drawARFrame(context as never, null, { width: 800, height: 450 }, { ...DEFAULT_AR_SETTINGS, showAxes: true, scale: 1.5 }, 'Make It Possible', 1000);
    expect(calls).not.toContain('drawImage');
    expect(calls.filter(call => call === 'stroke').length).toBe(Math.ceil(800 / 40) + Math.ceil(450 / 40) + 2);
    expect(context.filter).toBe('brightness(1)');
    expect(texts).toEqual(['📱 Make It Possible', '🎯 AR Activo', '📏 Escala: 150%']);
  });

  test('sin cuadrícula ni ejes solo se pinta el cubo y la ficha', () => {
    const { context, calls } = fakeContext();
    drawARFrame(context as never, null, { width: 800, height: 450 }, { ...DEFAULT_AR_SETTINGS, showGrid: false }, 'X', 0);
    expect(calls).not.toContain('stroke');
    expect(calls).toContain('strokeRect');
  });
});
