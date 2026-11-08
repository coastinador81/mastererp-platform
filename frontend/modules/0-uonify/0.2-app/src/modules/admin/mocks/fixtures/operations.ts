import type { AiProvider, AuditEntry, TeamMember } from '../../model/types';
import { daysAgo } from './time';

/** Equipo simulado. En el backend, el alta y la baja las hace un superadmin. */
export const TEAM: TeamMember[] = [
  { email: 'laura@uonify.com', name: 'Laura Méndez', role: 'superadmin' },
  { email: 'irene@uonify.com', name: 'Irene Sanz', role: 'finanzas' },
  { email: 'pablo@uonify.com', name: 'Pablo Ruiz', role: 'soporte' },
  { email: 'marc@uonify.com', name: 'Marc Vidal', role: 'operaciones' },
];

/**
 * Proveedores de IA de Uonify (lo que paga Uonify; lo que consume la cuenta de ChatGPT
 * del cliente no aparece aquí). Vídeo: con audio → Gemini API con respaldo en Vertex;
 * sin audio → Vertex con respaldo en Gemini API.
 */
export function seedProviders(): AiProvider[] {
  return [
    {
      id: 'openai',
      name: 'OpenAI API',
      usage: 'Uony de soporte y clasificación interna. Lo paga Uonify.',
      enabled: true,
      monthlyCapUsd: 1500,
      spentUsd: 412.35,
      successRate: 0.996,
      latencyP50Seconds: 1.8,
      models: [],
      pausedByCap: false,
    },
    {
      id: 'bedrock',
      name: 'Amazon Bedrock',
      usage: 'Respaldo de Uony de soporte. Lo paga Uonify.',
      enabled: true,
      monthlyCapUsd: 800,
      spentUsd: 671.2,
      successRate: 0.991,
      latencyP50Seconds: 2.4,
      fallback: { enabled: true, label: 'Respaldo de Uony de soporte si falla OpenAI API' },
      models: [],
      pausedByCap: false,
    },
    {
      id: 'veo-gemini',
      name: 'Veo · Gemini API',
      usage: 'Voz y vídeo de la propia plataforma (demos y soporte). Lo paga Uonify.',
      enabled: true,
      monthlyCapUsd: 2500,
      spentUsd: 1184,
      successRate: 0.962,
      latencyP50Seconds: 94,
      fallback: { enabled: true, label: 'Respaldo del vídeo sin audio si falla Vertex AI' },
      models: [{ id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Standard · 1080p' }],
      pausedByCap: false,
    },
    {
      id: 'veo-vertex',
      name: 'Veo · Vertex AI',
      usage: 'Respaldo de la voz y el vídeo de la plataforma.',
      enabled: true,
      monthlyCapUsd: 2500,
      spentUsd: 642.6,
      successRate: 0.974,
      latencyP50Seconds: 81,
      fallback: { enabled: true, label: 'Respaldo del vídeo con audio si falla Gemini API' },
      models: [{ id: 'veo-3.1-generate-001', label: 'Veo 3.1 Standard · 1080p', retiresAt: '2026-11-17' }],
      pausedByCap: false,
    },
  ];
}

/** Registro inicial: acciones de los últimos días. */
export function seedAudit(): AuditEntry[] {
  const pablo = { email: 'pablo@uonify.com', name: 'Pablo Ruiz' };
  const irene = { email: 'irene@uonify.com', name: 'Irene Sanz' };
  const laura = { email: 'laura@uonify.com', name: 'Laura Méndez' };
  const marc = { email: 'marc@uonify.com', name: 'Marc Vidal' };
  return [
    { id: 'aud_seed_8', at: daysAgo(1, 18, 5), actor: marc, action: 'provider.update', target: { type: 'proveedor', id: 'bedrock', label: 'Amazon Bedrock' }, reason: 'Sube el gasto por las descripciones en bloque: tope de 600 a 800 $.', detail: 'Tope mensual: 600,00 US$ → 800,00 US$' },
    { id: 'aud_seed_7', at: daysAgo(2, 12, 30), actor: pablo, action: 'customer.balance_adjust', target: { type: 'cliente', id: 'acc_6MN1QS', label: 'Senda Outdoor' }, reason: 'Se amplía el acceso una semana por un fallo del servicio.', detail: '+9,90 € (Ajuste de cortesía)' },
    { id: 'aud_seed_6', at: daysAgo(2, 12, 10), actor: pablo, action: 'customer.note', target: { type: 'cliente', id: 'acc_6MN1QS', label: 'Senda Outdoor' } },
    { id: 'aud_seed_5', at: daysAgo(4, 9, 45), actor: laura, action: 'customer.ai_block', target: { type: 'cliente', id: 'acc_1ZW6PF', label: 'Mar de Lino' }, reason: 'Picos de 40 vídeos por hora con la tarjeta recién cambiada. Se revisa con el cliente.' },
    { id: 'aud_seed_4', at: daysAgo(6, 16, 20), actor: irene, action: 'customer.suspend', target: { type: 'cliente', id: 'acc_2VB7YL', label: 'Pixel Mascotas' }, reason: 'Impago: la renovación anual se rechazó tres veces.' },
    { id: 'aud_seed_3', at: daysAgo(8, 11, 0), actor: laura, action: 'plan.update', target: { type: 'plan', id: 'subscription', label: 'Suscripción' }, reason: 'Precio de la suscripción aprobado por dirección.', detail: 'Precio mensual: 9,90 € · anual: 118,80 €' },
    { id: 'aud_seed_2', at: daysAgo(8, 10, 40), actor: laura, action: 'admin.signin', target: { type: 'sesion', id: 'laura@uonify.com', label: 'Panel de administración' } },
    { id: 'aud_seed_1', at: daysAgo(9, 15, 15), actor: pablo, action: 'article.publish', target: { type: 'articulo', id: 'conectar-amazon', label: 'Cómo conectar tu cuenta de Amazon' } },
  ];
}
