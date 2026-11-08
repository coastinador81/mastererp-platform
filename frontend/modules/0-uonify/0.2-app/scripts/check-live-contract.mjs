// Contrato entre extremos de la voz en directo: cada acción que el servidor puede
// anunciar en un handoff debe estar en LIVE_WORK_INTENTS. Si falta, el navegador
// toma el aviso por un error de protocolo y corta la voz (20-10-2026: drive_assist).
// Uso: npm run check:contract
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const decision = read('../../backend/app/uony_semantic_decision.py');
const transport = read('../src/modules/workspace/api/liveTransport.ts');
const quoted = text => [...text.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);

const actions = /^Action = Literal\[([^\]]+)\]/m.exec(decision)?.[1];
const intents = /export const LIVE_WORK_INTENTS = \[([^\]]+)\]/.exec(transport)?.[1];
if (!actions || !intents) {
  console.error('No se encuentran Action (backend) o LIVE_WORK_INTENTS (frontend).');
  process.exit(1);
}
// 'conversation' se responde en la propia conversación: nunca llega como handoff.
const missing = quoted(actions).filter(action => action !== 'conversation'
  && !quoted(intents).includes(action));
if (missing.length) {
  console.error(`Acciones del servidor que el navegador rechazaría: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('OK: el navegador acepta todas las acciones de voz que anuncia el servidor.');
