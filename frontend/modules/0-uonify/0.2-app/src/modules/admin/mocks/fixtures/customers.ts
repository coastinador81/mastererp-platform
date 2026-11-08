import type { CustomerDetail, LedgerEntry } from '../../model/types';
import { daysAgo, daysFromNow } from './time';

/**
 * Cuentas simuladas (empresas ficticias con dominios .test). El saldo no se guarda:
 * sale de la suma del libro de movimientos, como en el backend.
 */
export type CustomerRecord = Omit<CustomerDetail, 'ledger' | 'balanceTokens'>;

/** Estado de suscripción (sin tokens): la antigua clave de plan se reinterpreta. */
const PLAN_NAMES: Record<string, string> = { free: 'Prueba (14 días)', basic: 'Mensual', pro: 'Anual', max: 'Anual', custom: 'Anual' };
const SEATS: Record<string, number | null> = { free: 1, basic: 2, pro: 4, max: 10, custom: null };

interface Seed {
  id: string;
  company: string;
  owner: [name: string, email: string];
  plan: keyof typeof PLAN_NAMES;
  created: number;
  active: number;
  seatsUsed: number;
  seller?: string;
  amazonStatus?: 'active' | 'expiring' | 'revoked' | 'error';
  chatgpt?: boolean;
  status?: CustomerRecord['status'];
  suspendReason?: string;
  aiBlocked?: boolean;
  extraMembers?: CustomerRecord['members'];
}

const SEEDS: Seed[] = [
  { id: 'acc_7Q2M4K', company: 'Lumen Juguetes', owner: ['Marta Iglesias', 'marta@lumen-juguetes.test'], plan: 'pro', created: 41, active: 0, seatsUsed: 3, seller: 'A2LUMEN7QX4ES', amazonStatus: 'active', chatgpt: true, extraMembers: [{ name: 'Óscar Pardo', email: 'oscar@lumen-juguetes.test', role: 'editor' }, { name: 'Lucía Gil', email: 'lucia@lumen-juguetes.test', role: 'administrador' }] },
  { id: 'acc_3HX9TB', company: 'Casa Norte Hogar', owner: ['Jorge Salas', 'jorge@casanorte.test'], plan: 'basic', created: 26, active: 1, seatsUsed: 2, seller: 'A1CNORTE83ES', amazonStatus: 'expiring', chatgpt: true, extraMembers: [{ name: 'Nerea Salas', email: 'nerea@casanorte.test', role: 'editor' }] },
  { id: 'acc_9PL2WD', company: 'Bruma Cosmética', owner: ['Clara Ruiz', 'clara@bruma.test'], plan: 'max', created: 88, active: 0, seatsUsed: 7, seller: 'A3BRUMA55ES', amazonStatus: 'active', chatgpt: true },
  { id: 'acc_4KD8RZ', company: 'Ferretería Albar', owner: ['Tomás Albar', 'tomas@albar.test'], plan: 'free', created: 6, active: 2, seatsUsed: 1, chatgpt: true },
  { id: 'acc_6MN1QS', company: 'Senda Outdoor', owner: ['Irene Castro', 'irene@senda-outdoor.test'], plan: 'pro', created: 63, active: 9, seatsUsed: 4, seller: 'A2SENDA19ES', amazonStatus: 'error', chatgpt: false },
  { id: 'acc_2VB7YL', company: 'Pixel Mascotas', owner: ['Raúl Medina', 'raul@pixelmascotas.test'], plan: 'basic', created: 19, active: 30, seatsUsed: 1, status: 'suspended', suspendReason: 'Impago: la renovación anual se rechazó tres veces.', chatgpt: true },
  { id: 'acc_8TR5HC', company: 'Atelier Oliva', owner: ['Sofía Oliva', 'sofia@atelier-oliva.test'], plan: 'free', created: 3, active: 0, seatsUsed: 1, chatgpt: true },
  { id: 'acc_5GH3NE', company: 'Kiro Electrónica', owner: ['Daniel Vega', 'daniel@kiro.test'], plan: 'custom', created: 120, active: 0, seatsUsed: 14, seller: 'A1KIRO77ES', amazonStatus: 'active', chatgpt: true },
  { id: 'acc_1ZW6PF', company: 'Mar de Lino', owner: ['Elena Soto', 'elena@mardelino.test'], plan: 'pro', created: 34, active: 4, seatsUsed: 2, seller: 'A3MARLINO2ES', amazonStatus: 'revoked', aiBlocked: true, chatgpt: false },
  { id: 'acc_0QA4JU', company: 'Nido Bebé', owner: ['Paula Ortega', 'paula@nidobebe.test'], plan: 'free', created: 52, active: 51, seatsUsed: 1, status: 'pending_deletion', suspendReason: 'Petición del cliente: borrar la cuenta y sus datos.' },
];

function amazon(seed: Seed): CustomerRecord['amazon'] {
  if (!seed.seller || !seed.amazonStatus) return null;
  const authorized = seed.amazonStatus === 'expiring' ? 344 : seed.created - 1;
  return {
    sellerId: seed.seller,
    marketplace: 'Amazon.es',
    status: seed.amazonStatus,
    authorizedAt: daysAgo(authorized),
    expiresAt: daysFromNow(365 - authorized),
  };
}

function jobs(seed: Seed): CustomerRecord['jobs'] {
  if (seed.plan === 'free') {
    return [{ id: `job_${seed.id}_1`, kind: 'support', label: 'Uony de soporte', provider: 'OpenAI API', status: 'done', chargedTokens: 0, at: daysAgo(seed.active) }];
  }
  return [
    { id: `job_${seed.id}_1`, kind: 'video', label: 'Vídeo de 30 s con audio', provider: 'Veo · Gemini API', status: 'done', chargedTokens: 1680, at: daysAgo(seed.active + 1, 11) },
    { id: `job_${seed.id}_2`, kind: 'video', label: 'Vídeo de 15 s sin audio', provider: 'Veo · Vertex AI', status: seed.id === 'acc_6MN1QS' ? 'failed' : 'filtered', chargedTokens: 0, at: daysAgo(seed.active + 2, 16), error: seed.id === 'acc_6MN1QS' ? 'Tiempo de espera agotado en Vertex AI (6 min).' : 'Plano 2 bloqueado por el filtro de seguridad de Google. No se cobra.' },
    { id: `job_${seed.id}_3`, kind: 'manual', label: 'Descripciones de 12 productos', provider: 'Amazon Bedrock', status: 'done', chargedTokens: 240, at: daysAgo(seed.active + 3, 9) },
  ];
}

function acceptances(seed: Seed): CustomerRecord['acceptances'] {
  const list = [
    { document: 'Condiciones de uso', version: '2026-09-01', acceptedAt: daysAgo(seed.created), where: 'Alta' },
    { document: 'Política de privacidad', version: '2026-09-01', acceptedAt: daysAgo(seed.created), where: 'Alta' },
    { document: 'Modelos de IA de terceros', version: '2026-09-26', acceptedAt: daysAgo(Math.min(seed.created, 1)), where: 'Alta' },
  ];
  return list;
}

export function seedCustomers(): CustomerRecord[] {
  return SEEDS.map(seed => ({
    id: seed.id,
    company: seed.company,
    ownerName: seed.owner[0],
    ownerEmail: seed.owner[1],
    planId: seed.plan,
    planName: PLAN_NAMES[seed.plan],
    status: seed.status ?? 'active',
    suspendReason: seed.suspendReason,
    aiBlocked: seed.aiBlocked ?? false,
    stripeCustomerId: `cus_${seed.id.slice(4)}Ux${seed.created}`,
    amazonSellerId: seed.seller ?? null,
    createdAt: daysAgo(seed.created),
    lastActiveAt: daysAgo(seed.active, 17, 20),
    seatsUsed: seed.seatsUsed,
    seatsAllowed: SEATS[seed.plan],
    chatgptConnected: seed.chatgpt ?? false,
    members: [{ name: seed.owner[0], email: seed.owner[1], role: 'propietario' }, ...(seed.extraMembers ?? [])],
    amazon: amazon(seed),
    jobs: jobs(seed),
    acceptances: acceptances(seed),
    notes: seed.id === 'acc_6MN1QS'
      ? [{ id: 'note_1', author: 'Pablo Ruiz', text: 'Pidió ayuda para reconectar Amazon: el token de SP-API da error desde el martes.', at: daysAgo(2, 12) }]
      : [],
  }));
}

/**
 * Libro de movimientos de la suscripción, en euros (guardado en céntimos, 100 = 1 €,
 * como el backend). Sin tokens: solo cobros de suscripción, reembolsos y ajustes de
 * cortesía. El consumo de IA lo paga el cliente desde su cuenta de Google y no aparece.
 */
export function seedLedger(): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  SEEDS.forEach(seed => {
    if (seed.plan === 'free') return; // en prueba: aún sin cobros
    const base = { customerId: seed.id, status: 'posted' as const };
    const annual = seed.plan === 'pro' || seed.plan === 'max' || seed.plan === 'custom';
    entries.push(
      annual
        ? { ...base, id: `led_${seed.id}_1`, at: daysAgo(seed.created - 1), type: 'recarga', tokens: 11_880, description: 'Suscripción anual (118,80 € + IVA) · tarjeta' }
        : { ...base, id: `led_${seed.id}_1`, at: daysAgo(seed.created - 1), type: 'recarga', tokens: 990, description: 'Suscripción mensual (9,90 € + IVA) · tarjeta' },
    );
    if (!annual) {
      entries.push({ ...base, id: `led_${seed.id}_2`, at: daysAgo(Math.max(0, seed.active - 1), 10), type: 'recarga', tokens: 990, description: 'Renovación mensual (9,90 € + IVA) · tarjeta' });
    }
  });
  entries.push({
    id: 'led_acc_6MN1QS_5',
    customerId: 'acc_6MN1QS',
    status: 'posted',
    at: daysAgo(2, 12, 30),
    type: 'ajuste',
    tokens: 990,
    description: 'Ajuste de cortesía',
    category: 'compensacion',
    reason: 'Se amplía el acceso una semana por un fallo del servicio.',
    author: 'Pablo Ruiz',
  });
  return entries;
}
