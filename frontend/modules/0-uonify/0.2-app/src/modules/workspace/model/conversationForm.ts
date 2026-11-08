import { isPimTabKey, type PimTabKey } from '@/shared/pim';
import type { AmazonReasoning } from '@/modules/catalog';

export interface ProductGuideContext {
  kind: 'product_guide';
  sku: string;
  revision: number;
  section: 'choice' | 'amazon_requirements' | PimTabKey;
  step?: 'source' | 'reference' | 'type' | 'fields' | 'reasoning';
  evaluationId?: string;
}
export interface ProductIncidentContext {
  kind: 'product_incident'; incidentId: string; revision: number;
  step: 'edit' | 'review' | 'waiting' | 'pick';
}
export interface DriveAnalysisContext {
  kind: 'drive_analysis'; sku: string; revision: number; section: 'review';
  analysisId: string; proposalIds: string[];
}
export interface FieldValidation {
  number?: 'number' | 'integer'; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string;
}

export interface ConversationField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
  value?: string;
  closed?: boolean;
  hint?: string;
  validation?: FieldValidation;
  suggestion?: { value: string; source: string };
  resourceEvidence?: { sourceName: string; locator: string; excerpt: string }[];
}

export interface ConversationFormData {
  id: string;
  title: string;
  fields: ConversationField[];
  /** Presentación acotada de una sola pregunta en el hilo; nunca autoriza acciones. */
  presentation?: 'inline_choice';
  context?: ProductGuideContext | ProductIncidentContext | DriveAnalysisContext;
  review?: { label: string; before: string; after: string }[];
  submitLabel?: string;
  notice?: string;
  reasoning?: AmazonReasoning;
}

/** Un estado de trabajo estructurado vive junto al compositor, nunca como respuesta final. */
export function isRequirementsProgress(form: ConversationFormData | undefined): boolean {
  return form?.context?.kind === 'product_guide' && form.context.section === 'amazon_requirements'
    && form.context.step === 'reasoning';
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const plain = (value: string) => !/[<>]|(?:https?|javascript|data|file):|www\.|:\/\//i.test(value)
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 && character !== '\t' && character !== '\n');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && plain(value);
const noSecrets = (value: string) => !/contrasen|password|passphrase|token|api.?key|clave.{0,20}(secreta|privada|api)|secret|tarjeta|credit.?card|cvv|cvc|numero.{0,10}cuenta|iban/i.test(value.normalize('NFKD').replace(/\p{M}/gu, ''));
const identifier = (value: unknown): value is string => text(value, 64) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const presentation = (value: unknown, max: number, incident: boolean): value is string => incident
  ? typeof value === 'string' && !!value.trim() && value.length <= max && !Array.from(value).some(character => character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character))
  : text(value, max) && noSecrets(value);

/** Solo datos de presentación; nunca HTML, rutas de envío ni órdenes ejecutables. */
export function conversationFormOf(value: unknown, role: unknown): ConversationFormData | undefined {
  const incident = record(value) && record(value.context) && value.context.kind === 'product_incident';
  const requirements = record(value) && record(value.context) && value.context.kind === 'product_guide' && value.context.section === 'amazon_requirements';
  const drive = record(value) && record(value.context) && value.context.kind === 'drive_analysis';
  const amazon = incident || requirements || drive;
  const waiting = requirements && record(value) && record(value.context) && value.context.step === 'reasoning';
  if (role !== 'assistant' || !record(value) || !text(value.id, 64) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value.id) || !presentation(value.title, 120, amazon)
    || !Array.isArray(value.fields) || (!value.fields.length && !waiting) || value.fields.length > 8 || (waiting && value.fields.length)) return undefined;
  const ids = new Set<string>();
  const fields: ConversationField[] = [];
  let context: ConversationFormData['context'];
  if (value.context !== undefined) {
    const source = value.context;
    if (record(source) && source.kind === 'product_incident') {
      if (typeof source.incidentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(source.incidentId)
        || typeof source.revision !== 'number' || !Number.isSafeInteger(source.revision) || source.revision < 1
        || !['edit', 'review', 'waiting', 'pick'].includes(String(source.step))) return undefined;
      context = { kind: 'product_incident', incidentId: source.incidentId, revision: source.revision, step: source.step as ProductIncidentContext['step'] };
    } else if (record(source) && source.kind === 'drive_analysis') {
      if (typeof source.sku !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(source.sku)
        || typeof source.revision !== 'number' || !Number.isSafeInteger(source.revision) || source.revision < 1
        || source.section !== 'review' || typeof source.analysisId !== 'string' || !/^[0-9a-f-]{36}$/i.test(source.analysisId)
        || !Array.isArray(source.proposalIds) || source.proposalIds.length > 7
        || !source.proposalIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return undefined;
      context = { kind: 'drive_analysis', sku: source.sku, revision: source.revision, section: 'review', analysisId: source.analysisId, proposalIds: [...source.proposalIds] };
    } else {
      if (!record(source) || source.kind !== 'product_guide' || typeof source.sku !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(source.sku) || typeof source.revision !== 'number'
      || !Number.isSafeInteger(source.revision) || source.revision < 1
      || (source.section !== 'choice' && source.section !== 'amazon_requirements' && !isPimTabKey(source.section))) return undefined;
      context = { kind: 'product_guide', sku: source.sku, revision: source.revision, section: source.section };
      if (source.section === 'amazon_requirements') {
        if (!['source', 'reference', 'type', 'fields', 'reasoning'].includes(String(source.step))) return undefined;
        if (source.step === 'fields' && (typeof source.evaluationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.evaluationId))) return undefined;
        context.step = source.step as ProductGuideContext['step'];
        if (typeof source.evaluationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(source.evaluationId)) context.evaluationId = source.evaluationId;
      }
    }
  }
  for (const item of value.fields) {
    if (!record(item) || !identifier(item.id) || !noSecrets(item.id) || ids.has(item.id) || !presentation(item.label, 100, amazon)
      || typeof item.type !== 'string' || !['text', 'textarea', 'select'].includes(item.type) || typeof item.required !== 'boolean'
      || (item.value !== undefined && (typeof item.value !== 'string' || item.value.length > 3000 || (!context && !plain(item.value))))) return undefined;
    ids.add(item.id);
    const field: ConversationField = { id: item.id, label: item.label, type: item.type as ConversationField['type'], required: item.required };
    if (field.type === 'select') {
      if (!Array.isArray(item.options) || !item.options.length || item.options.length > (requirements ? 1000 : incident ? 500 : 20)
        || !item.options.every(option => presentation(option, 160, amazon)) || new Set(item.options).size !== item.options.length
        || (item.value && !item.options.includes(item.value) && !(amazon && item.closed === false))) return undefined;
      field.options = [...item.options];
    }
    if (typeof item.value === 'string') field.value = item.value;
    if (item.resourceEvidence !== undefined) {
      // No omitir citas inválidas y dejar al cliente decidir con una lista incompleta.
      if (!drive || !Array.isArray(item.resourceEvidence) || !item.resourceEvidence.length || item.resourceEvidence.length > 5000
        || !item.resourceEvidence.every(entry => record(entry) && presentation(entry.sourceName, 500, true)
          && presentation(entry.locator, 500, true) && presentation(entry.excerpt, 300, true))) return undefined;
      field.resourceEvidence = item.resourceEvidence.map(entry => ({ sourceName: entry.sourceName as string,
        locator: entry.locator as string, excerpt: entry.excerpt as string }));
    }
    if (amazon) {
      if (typeof item.closed === 'boolean') field.closed = item.closed;
      if (typeof item.hint === 'string' && item.hint.length <= 600) field.hint = item.hint;
      if (record(item.validation)) {
        const limits: FieldValidation = {};
        for (const key of ['minimum', 'maximum', 'minLength', 'maxLength'] as const) {
          const limit = item.validation[key];
          if (typeof limit === 'number' && Number.isFinite(limit)) limits[key] = limit;
        }
        if (item.validation.number === 'number' || item.validation.number === 'integer') limits.number = item.validation.number;
        if (typeof item.validation.pattern === 'string' && item.validation.pattern.length <= 500) limits.pattern = item.validation.pattern;
        field.validation = limits;
      }
      if (record(item.suggestion) && typeof item.suggestion.value === 'string' && item.suggestion.value.length <= 3000
        && typeof item.suggestion.source === 'string' && item.suggestion.source.length <= 300
        && (!field.closed || field.type !== 'select' || field.options?.includes(item.suggestion.value))) {
        field.suggestion = { value: item.suggestion.value, source: item.suggestion.source };
      }
    }
    fields.push(field);
  }
  if (value.presentation !== undefined && (value.presentation !== 'inline_choice' || context
    || fields.length !== 1 || fields[0].type !== 'select' || !fields[0].required
    || fields[0].id !== 'product_sources'
    || fields[0].label !== '¿Tienes fotos o documentos del producto, o partimos desde cero?'
    || fields[0].value !== undefined
    || fields[0].options?.[0] !== 'Tengo una carpeta en Drive'
    || fields[0].options?.[1] !== 'Partimos desde cero'
    || fields[0].options?.length !== 2)) return undefined;
  const form: ConversationFormData = { id: value.id, title: value.title, fields, ...(context ? { context } : {}) };
  if (value.presentation === 'inline_choice') form.presentation = 'inline_choice';
  if (requirements && value.reasoning !== undefined) {
    const item = value.reasoning;
    if (!record(item) || (!text(item.id, 128) && !(item.id === null && item.requiresPreparation === true)) || !['queued', 'running', 'completed', 'error', 'unknown', 'stale'].includes(String(item.status))
      || !presentation(item.message, 600, true)) return undefined;
    form.reasoning = { id: item.id as string | null, status: item.status as AmazonReasoning['status'], message: item.message };
    for (const key of ['canRetry', 'requiresConsumptionAcknowledgement', 'materialsPending', 'requiresPreparation'] as const) {
      if (typeof item[key] === 'boolean') form.reasoning[key] = item[key];
    }
  }
  if (context?.kind === 'product_incident') {
    if (Array.isArray(value.review) && value.review.length <= 100 && value.review.every(row => record(row)
      && typeof row.label === 'string' && row.label.length <= 100 && typeof row.before === 'string' && row.before.length <= 6000
      && typeof row.after === 'string' && row.after.length <= 6000)) form.review = value.review as NonNullable<ConversationFormData['review']>;
  }
  if (amazon && text(value.submitLabel, 60)) form.submitLabel = value.submitLabel;
  if (context && presentation(value.notice, 600, true)) form.notice = value.notice;
  return form;
}

export function formResponse(form: ConversationFormData, values: Record<string, string>, customFieldIds: ReadonlySet<string> = new Set()): { text: string; error?: undefined } | { error: string; text?: undefined } {
  const lines = [form.title];
  for (const field of form.fields) {
    const value = (values[field.id] ?? '').trim();
    if (field.required && !value) return { error: `Completa «${field.label}» para continuar.` };
    if (field.type === 'select' && value && (field.closed || !customFieldIds.has(field.id)) && !field.options?.includes(value)) return { error: `Elige una opción válida en «${field.label}».` };
    const rule = field.validation;
    if (value && rule) {
      if (rule.minLength !== undefined && value.length < rule.minLength) return { error: `«${field.label}» necesita al menos ${rule.minLength} caracteres.` };
      if (rule.maxLength !== undefined && value.length > rule.maxLength) return { error: `«${field.label}» admite como máximo ${rule.maxLength} caracteres.` };
      if (rule.number) {
        const number = Number(value.replace(',', '.'));
        if (!Number.isFinite(number) || (rule.number === 'integer' && !Number.isInteger(number))) return { error: `Introduce un número ${rule.number === 'integer' ? 'entero ' : ''}válido en «${field.label}».` };
        if (rule.minimum !== undefined && number < rule.minimum) return { error: `El mínimo admitido en «${field.label}» es ${rule.minimum}.` };
        if (rule.maximum !== undefined && number > rule.maximum) return { error: `El máximo admitido en «${field.label}» es ${rule.maximum}.` };
      }
    }
    if (value) lines.push(`${field.label}: ${value}`);
  }
  if (lines.length === 1) {
    if (form.context?.kind === 'product_guide' && form.context.section !== 'choice') return { text: `${form.title}\nContinuar con estos datos pendientes.` };
    return { error: 'Completa al menos un campo o responde a Uony con un mensaje.' };
  }
  const response = lines.join('\n');
  if (response.length > 3000) {
    // La guía envía los campos completos por formResponse; el hilo muestra un resumen legible.
    if (form.context) return { text: `${response.slice(0, 2860)}…\nLas respuestas completas se incluyen en el formulario enviado.` };
    return { error: 'Resume tus respuestas: el mensaje admite hasta 3000 caracteres.' };
  }
  return { text: response };
}
