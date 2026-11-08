/**
 * QR de la simulación. El backend real genera el QR del enlace otpauth:// y lo
 * devuelve como imagen; aquí se dibuja un patrón con el aspecto de un QR (las tres
 * esquinas de posición y módulos derivados de la clave). No se escanea: la
 * simulación acepta cualquier código de 6 cifras.
 */
const SIZE = 25;

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function finder(x: number, y: number, col: number, row: number): boolean | null {
  const dx = col - x;
  const dy = row - y;
  if (dx < -1 || dy < -1 || dx > 7 || dy > 7) return null;
  if (dx === -1 || dy === -1 || dx === 7 || dy === 7) return false;
  const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
  const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
  return edge || core;
}

export function pseudoQrSvg(seedText: string): string {
  let state = hash(seedText) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const cells: string[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const fixed = finder(0, 0, col, row) ?? finder(SIZE - 7, 0, col, row) ?? finder(0, SIZE - 7, col, row);
      const timing = row === 6 || col === 6 ? (row + col) % 2 === 0 : null;
      const on = fixed ?? timing ?? next() > 0.52;
      if (on) cells.push(`M${col + 2} ${row + 2}h1v1h-1z`);
    }
  }
  const box = SIZE + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path fill="#152438" d="${cells.join('')}"/></svg>`;
}

export function pseudoQrDataUrl(seedText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pseudoQrSvg(seedText))}`;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Clave TOTP de ejemplo en base32 (32 caracteres = 160 bits). */
export function randomBase32(length = 32, random: () => number = Math.random): string {
  return Array.from({ length }, () => BASE32[Math.floor(random() * 32) % 32]).join('');
}
