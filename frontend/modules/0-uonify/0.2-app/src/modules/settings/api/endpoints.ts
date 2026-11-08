/**
 * Rutas del backend que usa Configuración (bajo API_BASE, «/api» por defecto).
 * Las de /account, /security, /connections, /team, /brands y /privacy son de este
 * módulo (y las simula mocks/). /ai/usage es del módulo workspace y /billing/* del
 * módulo billing: aquí solo se leen.
 */
export const ENDPOINTS = {
  account: '/account',
  accountAvatar: '/account/avatar',
  accountEmailStart: '/account/email/start',
  accountEmailConfirm: '/account/email/confirm',

  mfa: '/security/mfa',
  totpSetup: '/security/mfa/totp/setup',
  totpVerify: '/security/mfa/totp/verify',
  totp: '/security/mfa/totp',
  smsStart: '/security/mfa/sms/start',
  smsVerify: '/security/mfa/sms/verify',
  sms: '/security/mfa/sms',
  recoveryCodes: '/security/mfa/recovery-codes',
  sessions: '/security/sessions',
  session: (id: string) => `/security/sessions/${encodeURIComponent(id)}`,
  signInMethods: '/security/sign-in-methods',
  signInMethod: (id: string) => `/security/sign-in-methods/${encodeURIComponent(id)}`,

  connections: '/connections',
  connect: (provider: 'chatgpt' | 'amazon') => `/connections/${provider}/connect`,
  disconnect: (provider: 'chatgpt' | 'amazon') => `/connections/${provider}`,
  amazonRenew: '/connections/amazon/renew',

  team: '/team',
  invitations: '/team/invitations',
  invitationResend: (id: string) => `/team/invitations/${encodeURIComponent(id)}/resend`,
  member: (id: string) => `/team/members/${encodeURIComponent(id)}`,

  brands: '/brands',
  brand: (id: string) => `/brands/${encodeURIComponent(id)}`,
  brandApply: (id: string) => `/brands/${encodeURIComponent(id)}/apply`,

  privacy: '/privacy',
  privacyExport: '/privacy/export',
  privacyExportDownload: (id: string) => `/privacy/export/${encodeURIComponent(id)}/download`,
  privacyCookies: '/privacy/cookies',
  privacyDeletion: '/privacy/deletion',

  aiUsage: '/ai/usage',
  billingBalance: '/billing/balance',
  billingMovements: '/billing/movements',
} as const;

/** Claves de TanStack Query del módulo. */
export const settingsKeys = {
  all: ['settings'] as const,
  account: ['settings', 'account'] as const,
  mfa: ['settings', 'security', 'mfa'] as const,
  sessions: ['settings', 'security', 'sessions'] as const,
  signInMethods: ['settings', 'security', 'sign-in-methods'] as const,
  connections: ['settings', 'connections'] as const,
  team: ['settings', 'team'] as const,
  brands: ['settings', 'brands'] as const,
  privacy: ['settings', 'privacy'] as const,
  aiUsage: ['settings', 'ai-usage'] as const,
  balance: ['settings', 'billing', 'balance'] as const,
  movements: ['settings', 'billing', 'movements'] as const,
};
