export interface ProductMaterialAnalysisContext { sku: string; revision: number }
export interface InstructionMaterialAnalysisContext { jobId: string; intakeId: string | null; assignmentId?: string }
export type MaterialAnalysisContext = ProductMaterialAnalysisContext | InstructionMaterialAnalysisContext;

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function productMaterialAnalysisOf(value: MaterialAnalysisContext | undefined):
  ProductMaterialAnalysisContext | undefined {
  return value && 'sku' in value ? value : undefined;
}

export function instructionMaterialAnalysisOf(value: MaterialAnalysisContext | undefined):
  InstructionMaterialAnalysisContext | undefined {
  return value && 'jobId' in value ? value : undefined;
}

export function showInstructionDriveJob(value: InstructionMaterialAnalysisContext | undefined): boolean {
  // También con un encargo sin ficha: su tarjeta resume el estado, pero no muestra
  // las observaciones. ConversationMessages monta solo el último mensaje del jobId.
  return !!value;
}

export function materialAnalysisOf(value: unknown, role: unknown): MaterialAnalysisContext | undefined {
  if (role !== 'assistant' || typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.sku === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(item.sku)
    && typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 1)
    return { sku: item.sku, revision: item.revision };
  if (!uuid(item.jobId) || !(item.intakeId === null || uuid(item.intakeId))
    || item.assignmentId !== undefined && !uuid(item.assignmentId)) return undefined;
  return { jobId: item.jobId, intakeId: item.intakeId,
    ...(item.assignmentId ? { assignmentId: item.assignmentId } : {}) };
}
