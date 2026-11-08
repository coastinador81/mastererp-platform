/**
 * MD5 y conversiones de bytes para la subida de imágenes A+ (utils/md5.ts del
 * original, que usaba spark-md5). Amazon pide el MD5 del archivo en hexadecimal
 * al reservar el destino y en base64 al subirlo a S3. Implementación propia para
 * no añadir dependencias.
 */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

function wordToHex(word: number): string {
  let hex = '';
  for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return hex;
}

/** MD5 en hexadecimal (32 caracteres) de unos bytes. */
export function md5Hex(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const length = bytes.length;
  const padded = Math.ceil((length + 9) / 64) * 64;
  const buffer = new Uint8Array(padded);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bits = length * 8;
  view.setUint32(padded - 8, bits >>> 0, true);
  view.setUint32(padded - 4, Math.floor(bits / 2 ** 32) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let offset = 0; offset < padded; offset += 64) {
    for (let j = 0; j < 16; j++) words[j] = view.getUint32(offset + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << SHIFTS[i]) | (f >>> (32 - SHIFTS[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return wordToHex(a0) + wordToHex(b0) + wordToHex(c0) + wordToHex(d0);
}

/** Hexadecimal → base64 (calculateMD5Base64 del original). */
export function hexToBase64(hex: string): string {
  const bytes = hex.match(/.{2}/g)?.map(byte => parseInt(byte, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes));
}

/** Bytes → base64 (por tramos, para archivos de varios MB). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** base64 → bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
