import type { InvitableRole, Team, TeamMember, TeamRole } from './types';

/** Usuarios por plan (decisión del dueño): Gratis 1, Básico 2, Pro 4, Max 10; Personalizado según acuerdo. */
export const PLAN_SEATS: Readonly<Record<string, number | null>> = { free: 1, basic: 2, pro: 4, max: 10, custom: null };
export const PLAN_NAMES: Readonly<Record<string, string>> = { free: 'Gratis', basic: 'Básico', pro: 'Pro', max: 'Max', custom: 'Personalizado' };

export const ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  owner: 'Propietario',
  admin: 'Administrador',
  editor: 'Editor',
};

export const ROLE_DESCRIPTIONS: Readonly<Record<TeamRole, string>> = {
  owner: 'Tiene el control total del espacio, también de su eliminación.',
  admin: 'Gestiona usuarios, conexiones, plan y facturación, y trabaja con los productos.',
  editor: 'Trabaja con los productos y con Uony. No gestiona usuarios, conexiones ni facturación.',
};

export const INVITABLE_ROLES: readonly InvitableRole[] = ['admin', 'editor'];

/** Plazas ocupadas: miembros activos e invitaciones pendientes. */
export function seatsUsed(members: readonly Pick<TeamMember, 'status'>[]): number {
  return members.length;
}

/** ¿Cabe otra persona? null en total = según acuerdo (sin tope en la interfaz). */
export function hasFreeSeat(team: Pick<Team, 'seats'>): boolean {
  return team.seats.total === null || team.seats.used < team.seats.total;
}

/** «2 de 4 usuarios» · «3 usuarios» (plan Personalizado). */
export function seatsLabel(team: Pick<Team, 'seats'>): string {
  const { used, total } = team.seats;
  if (total === null) return `${used} ${used === 1 ? 'usuario' : 'usuarios'}`;
  return `${used} de ${total} ${total === 1 ? 'usuario' : 'usuarios'}`;
}

/** Puede gestionar usuarios quien es propietario o administrador. */
export function canManageTeam(role: TeamRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Orden de la lista: propietario, administradores, editores y, al final, invitaciones. */
export function sortMembers(members: readonly TeamMember[]): TeamMember[] {
  const rank: Record<TeamRole, number> = { owner: 0, admin: 1, editor: 2 };
  return [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return rank[a.role] - rank[b.role] || a.email.localeCompare(b.email);
  });
}
