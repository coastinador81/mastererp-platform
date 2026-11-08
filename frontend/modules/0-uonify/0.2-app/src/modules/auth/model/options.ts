/** Opciones de los desplegables del alta (prototipo: formulario #uon-profile-form). */
export interface Option {
  value: string;
  label: string;
}

export const AGE_OPTIONS: readonly Option[] = [
  { value: '', label: 'Selecciona tu franja' },
  { value: 'under18', label: 'Menos de 18' },
  { value: '18-24', label: '18–24' },
  { value: '25-34', label: '25–34' },
  { value: '35-44', label: '35–44' },
  { value: '45-54', label: '45–54' },
  { value: '55+', label: '55 o más' },
];

export const ROLE_OPTIONS: readonly Option[] = [
  { value: '', label: 'Selecciona una opción' },
  { value: 'brand', label: 'Marca o fabricante' },
  { value: 'seller', label: 'Vendedor o retailer' },
  { value: 'agency', label: 'Agencia o consultora' },
  { value: 'operations', label: 'Operaciones o logística' },
  { value: 'professional', label: 'Profesional independiente' },
  { value: 'other', label: 'Otro' },
];

export const SIZE_OPTIONS: readonly Option[] = [
  { value: '', label: 'Selecciona una opción' },
  { value: '1', label: 'Solo yo' },
  { value: '2-10', label: '2–10 personas' },
  { value: '11-50', label: '11–50 personas' },
  { value: '51-200', label: '51–200 personas' },
  { value: '201+', label: 'Más de 200' },
];

export const GOAL_OPTIONS: readonly Option[] = [
  { value: '', label: 'Selecciona una opción' },
  { value: 'catalog', label: 'Gestionar productos y canales' },
  { value: 'operations', label: 'Coordinar mi operación' },
  { value: 'integrations', label: 'Conectar herramientas' },
  { value: 'agents', label: 'Trabajar con agentes de IA' },
  { value: 'explore', label: 'Explorar Uonify' },
];

export const SOURCE_OPTIONS: readonly Option[] = [
  { value: '', label: 'Selecciona una opción' },
  { value: 'search', label: 'Buscador' },
  { value: 'social', label: 'Redes sociales' },
  { value: 'referral', label: 'Recomendación' },
  { value: 'event', label: 'Evento' },
  { value: 'partner', label: 'Un partner' },
  { value: 'other', label: 'Otro' },
];

/**
 * Pasos del alta (requisitos de OpenAI para socios: datos mínimos, condiciones
 * versionadas y el permiso del plan de ChatGPT aparte del inicio de sesión).
 */
export const ONBOARDING_STEPS = [
  { id: 'you', label: 'TÚ', name: 'Tú' },
  { id: 'work', label: 'TU TRABAJO', name: 'Tu trabajo' },
  { id: 'terms', label: 'CONDICIONES', name: 'Condiciones' },
  { id: 'chatgpt', label: 'PLAN DE CHATGPT', name: 'Plan de ChatGPT' },
  { id: 'plan', label: 'TU PLAN', name: 'Tu plan' },
  { id: 'done', label: 'LISTO', name: 'Listo' },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

export const PROFILE_STEP_COUNT = ONBOARDING_STEPS.length;

/** Índice de cada paso por su id. */
export const STEP_INDEX: Readonly<Record<OnboardingStepId, number>> = Object.fromEntries(
  ONBOARDING_STEPS.map((step, index) => [step.id, index]),
) as Record<OnboardingStepId, number>;

/** Etiqueta de cada paso (prototipo: #uon-onboard-step-label): «PASO 1 DE 6 · TÚ». */
export const STEP_LABELS: readonly string[] = ONBOARDING_STEPS.map(
  (step, index) => `PASO ${index + 1} DE ${ONBOARDING_STEPS.length} · ${step.label}`,
);
