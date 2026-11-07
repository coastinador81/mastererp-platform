export const colors = {
  primary: '#1a9b4a',
  primaryDark: '#157a3a',
  primarySoft: '#e8f6ec',
  accent: '#ffcf5a',
  ink: '#111827',
  text: '#374151',
  muted: '#6b7280',
  line: '#e5e7eb',
  canvas: '#f3f5f3',
  surface: '#ffffff',
  danger: '#dc2626',
  success: '#157a3a',
  offer: '#e11d48',
  navy: '#0f1f17',
} as const;

export const radii = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 } as const;

/** Columna móvil en web (mismo ancho que customer-app legacy). */
export const contentWidth = 440;
