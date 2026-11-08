import { http } from 'msw';
import { uid } from '@/shared/lib';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { isEmail } from '../model/format';
import { INVITABLE_ROLES, PLAN_NAMES, PLAN_SEATS } from '../model/team';
import type { InvitableRole, Team, TeamMember } from '../model/types';
import { nowIso, readJson, text } from './helpers';
import { accountRecord, membersStore, teamRecord } from './store';

/**
 * Usuarios del espacio (/api/team). Las plazas dependen del plan (Gratis 1,
 * Básico 2, Pro 4, Max 10) y cuentan también las invitaciones pendientes.
 *
 *   GET    /team                              → Team
 *   POST   /team/invitations                  { email, role: 'admin' | 'editor' } → TeamMember (status 'invited')
 *                                             400 invalid_email | invalid_role · 409 already_member
 *                                             402 { error: 'plan_required', feature: 'seats' } sin plazas libres
 *   POST   /team/invitations/:id/resend       → { ok } · 404
 *   PATCH  /team/members/:id                  { role } → TeamMember · 403 owner_role · 404
 *   DELETE /team/members/:id                  → { ok } (revoca su acceso y sus sesiones) · 403 owner_role · 404
 */
function members(): TeamMember[] {
  const account = accountRecord.get();
  // El propietario es la cuenta con la sesión abierta: nombre y correo de /account.
  return membersStore.all().map(member => (member.role === 'owner' ? { ...member, name: account.name, email: account.email } : member));
}

function team(): Team {
  const { planId, youId } = teamRecord.get();
  const list = members();
  return {
    planId,
    planName: PLAN_NAMES[planId] ?? planId,
    seats: { used: list.length, total: PLAN_SEATS[planId] ?? null },
    members: list,
    youId,
  };
}

const isInvitable = (value: unknown): value is InvitableRole => INVITABLE_ROLES.includes(value as InvitableRole);

export const teamHandlers = [
  http.get(mock(ENDPOINTS.team), async () => {
    await latency(300);
    return HttpResponse.json(team());
  }),

  http.post(mock(ENDPOINTS.invitations), async ({ request }) => {
    await latency(600);
    const body = await readJson<{ email: string; role: string }>(request);
    const email = text(body.email).toLowerCase();
    if (!isEmail(email)) return fail(400, 'Escribe un correo electrónico válido.', 'invalid_email');
    if (!isInvitable(body.role)) return fail(400, 'Elige el rol: Administrador o Editor.', 'invalid_role');
    if (members().some(member => member.email.toLowerCase() === email)) return fail(409, 'Esa persona ya está en tu espacio o tiene una invitación pendiente.', 'already_member');
    const current = team();
    if (current.seats.total !== null && current.seats.used >= current.seats.total) {
      const seats = current.seats.total;
      return HttpResponse.json({
        error: 'plan_required',
        feature: 'seats',
        message: `Tu plan ${current.planName} incluye ${seats} ${seats === 1 ? 'usuario' : 'usuarios'}. Elige un plan con más usuarios para invitar a esta persona.`,
      }, { status: 402 });
    }
    const member: TeamMember = { id: uid('mem'), name: '', email, role: body.role, status: 'invited', invitedAt: nowIso(), joinedAt: null, lastActiveAt: null };
    membersStore.upsert(member);
    return HttpResponse.json(member, { status: 201 });
  }),

  http.post(mock('/team/invitations/:id/resend'), async ({ params }) => {
    await latency(400);
    const member = membersStore.get(String(params.id));
    if (!member || member.status !== 'invited') return fail(404, 'Esa invitación ya no existe.', 'not_found');
    membersStore.patch(member.id, { invitedAt: nowIso() });
    return HttpResponse.json({ ok: true });
  }),

  http.patch(mock('/team/members/:id'), async ({ params, request }) => {
    await latency(400);
    const member = membersStore.get(String(params.id));
    if (!member) return fail(404, 'Esa persona ya no está en tu espacio.', 'not_found');
    if (member.role === 'owner') return fail(403, 'El rol del propietario no se puede cambiar.', 'owner_role');
    const { role } = await readJson<{ role: string }>(request);
    if (!isInvitable(role)) return fail(400, 'Elige el rol: Administrador o Editor.', 'invalid_role');
    return HttpResponse.json(membersStore.patch(member.id, { role }));
  }),

  http.delete(mock('/team/members/:id'), async ({ params }) => {
    await latency(450);
    const member = membersStore.get(String(params.id));
    if (!member) return fail(404, 'Esa persona ya no está en tu espacio.', 'not_found');
    if (member.role === 'owner') return fail(403, 'El propietario no se puede quitar del espacio.', 'owner_role');
    membersStore.remove(member.id);
    return HttpResponse.json({ ok: true });
  }),
];
