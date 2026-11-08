/**
 * Tachado de datos sensibles (regla U5 y §6 del gobierno de Vera): antes de enviar,
 * guardar o adjuntar un mensaje se ocultan tarjetas, IBAN, documentos de identidad,
 * contraseñas, códigos de verificación y claves. Lo hace el navegador (el dato no
 * sale) y lo repite el servidor. El NIE admite 7 u 8 dígitos: el importador de
 * Rentprivé no cazaba el NIE malformado de 8 y aquí sí se tacha.
 */
export type SensitiveKind = 'card' | 'iban' | 'id_document' | 'password' | 'code' | 'secret';

export interface Redaction {
  text: string;
  kinds: SensitiveKind[];
}

/** Algoritmo de Luhn: distingue una tarjeta de un número cualquiera. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

interface Rule {
  kind: SensitiveKind;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

const RULES: Rule[] = [
  {
    kind: 'secret',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|amzn1\.[\w.-]{10,}|Atzr\|[\w-]{20,}|ghp_[A-Za-z0-9]{20,})/g,
    replace: () => '[clave oculta]',
  },
  {
    kind: 'iban',
    pattern: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?[A-Z0-9]{1,3})?\b/gi,
    replace: () => '[IBAN oculto]',
  },
  {
    kind: 'card',
    pattern: /(?<!\b(?:ean|gtin|upc|isbn)\W{0,3})\b\d(?:[ -]?\d){12,18}\b/gi,
    replace: match => (luhn(match.replace(/\D/g, '')) ? '[tarjeta oculta]' : match),
  },
  {
    kind: 'id_document',
    pattern: /\b(?:\d{8}-?[A-Z]|[XYZ][ -]?\d{7,8}-?[A-Z])\b/gi,
    replace: () => '[documento oculto]',
  },
  {
    kind: 'password',
    pattern: /\b(contrase[ñn]a|password|passwd|pwd|clave)(\s+(?:de\s+[\p{L}]+\s+)?(?:es|era)\s+|\s*[:=]\s*)(\S+)/giu,
    replace: (_match, word, joiner) => `${word}${joiner}[oculto]`,
  },
  {
    kind: 'code',
    pattern: /\b(c[oó]digo|code|otp|pin)\b(?!\s+(?:postal|de error|de producto|ean|asin|de barras))([^\d\n]{0,20})(\d{4,8})\b/giu,
    replace: (_match, word, between) => `${word}${between}[código oculto]`,
  },
  {
    kind: 'secret',
    pattern: /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
    replace: () => '[clave oculta]',
  },
];

/** Devuelve el texto tachado y qué tipos de datos se han ocultado. */
export function redactSensitive(input: string): Redaction {
  let text = input;
  const kinds = new Set<SensitiveKind>();
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((value): value is string => typeof value === 'string');
      const next = rule.replace(match, ...groups);
      if (next !== match) kinds.add(rule.kind);
      return next;
    });
  }
  return { text, kinds: [...kinds] };
}
