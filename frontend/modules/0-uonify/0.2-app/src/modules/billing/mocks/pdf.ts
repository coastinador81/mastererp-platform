import { euros, longDate, percent } from '../model/money';
import type { BillingDocument } from '../model/types';

/**
 * PDF mínimo (una página, Helvetica) para simular la descarga de facturas, notas
 * de crédito y rectificativas. El backend real devolverá el PDF de Stripe o el
 * suyo propio con los datos fiscales completos.
 */
const TITLES: Record<BillingDocument['kind'], string> = {
  invoice: 'Factura',
  credit_note: 'Nota de crédito',
  corrective: 'Factura rectificativa',
};

// WinAnsiEncoding: el euro y las comillas tipográficas no están en Latin-1.
const WIN_ANSI: Record<string, number> = { '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '−': 0x2d };

function encodeChar(char: string): number {
  if (WIN_ANSI[char] !== undefined) return WIN_ANSI[char];
  const code = char.charCodeAt(0);
  if (code === 0xa0 || code === 0x202f) return 0x20;
  return code <= 0xff ? code : 0x3f;
}

function pdfText(value: string): string {
  return Array.from(value)
    .map(char => String.fromCharCode(encodeChar(char)))
    .join('')
    .replace(/[\\()]/g, match => `\\${match}`);
}

export function documentLines(doc: BillingDocument): string[] {
  const lines = [
    `${TITLES[doc.kind]} ${doc.number}`,
    `Fecha: ${longDate(doc.issuedAt)}`,
    doc.rectifies ? `Rectifica la factura ${doc.rectifies}` : '',
    '',
    `Concepto: ${doc.concept}`,
    `Base imponible: ${euros(doc.base)}`,
    `IVA (${percent(doc.vatRate)}): ${euros(doc.vat)}`,
    `Total: ${euros(doc.total)}`,
    '',
    'ETHICS CLOUD & SECURITY SERVICES LLC (Uonify) · hola@uonify.com',
    'Documento sin validez fiscal.',
  ];
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '');
}

/** Bytes de un PDF 1.4 válido con las líneas dadas. */
export function buildPdf(lines: string[]): Uint8Array {
  const content = [
    'BT',
    '/F1 20 Tf',
    '56 780 Td',
    `(${pdfText('Uonify')}) Tj`,
    '/F1 11 Tf',
    '0 -36 Td',
    ...lines.flatMap(line => [`(${pdfText(line)}) Tj`, '0 -18 Td']),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Todo el texto ya está en un byte por carácter (WinAnsi).
  return Uint8Array.from(body, char => char.charCodeAt(0) & 0xff);
}

export function documentPdf(doc: BillingDocument): Uint8Array {
  return buildPdf(documentLines(doc));
}
