import { collection, record } from '@/shared/mocks/db';
import type { AmazonContentDocument, AmazonContentMetadata, AmazonContentRecord } from '../model/amazonTypes';
import { seedContentDocument, SEED_BRAND, SEED_IMAGES } from './fixtures/seedDocument';

/**
 * «Cuenta de Amazon» simulada para A+: documentos, imágenes subidas y destinos
 * de subida, guardados con @/shared/mocks/db (sessionStorage).
 */
export type DocumentStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED';

export interface MockAplusDocument {
  /** contentReferenceKey */
  id: string;
  name: string;
  status: DocumentStatus;
  brandName: string;
  marketplaceId: string;
  /** ASIN enlazados (create_link / create_publish). */
  asins: string[];
  contentDocument: AmazonContentDocument;
  updateTime: string;
  submittedAt?: number;
}

export interface MockAplusImage {
  /** uploadDestinationId */
  id: string;
  contentType: string;
  /** Contenido en base64 (subido) … */
  image?: string;
  /** … o recurso estático del que leerlo (contenido de ejemplo). */
  asset?: string;
}

export interface MockUploadDestination {
  id: string;
  url: string;
  contentType: string;
  contentMD5: string;
  createdAt: number;
}

export const documents = collection<MockAplusDocument>('aplus-documents');
export const images = collection<MockAplusImage>('aplus-images');
export const destinations = collection<MockUploadDestination>('aplus-upload-destinations');
const seeded = record<string[]>('aplus-seeded-asins', () => []);

/** Revisión de Amazon simulada: un envío pasa a APPROVED al cabo de 45 s. */
export const REVIEW_MS = 45_000;

export const nowIso = (now = Date.now()) => new Date(now).toISOString();

export function newKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return random;
}

/** Aplica la revisión simulada si ya pasó su tiempo. */
export function reviewed(doc: MockAplusDocument, now = Date.now()): MockAplusDocument {
  if (doc.status === 'SUBMITTED' && doc.submittedAt && now - doc.submittedAt >= REVIEW_MS) {
    return documents.patch(doc.id, { status: 'APPROVED', updateTime: nowIso(now) }) ?? doc;
  }
  return doc;
}

/**
 * Cada ASIN que se consulta por primera vez ya tiene en la cuenta simulada un
 * contenido A+ publicado («Make It Possible» by Uonify), para ver la carga
 * completa con imágenes descargadas.
 */
export function ensureSeeded(asin: string, marketplaceId: string): void {
  if (!asin || seeded.get().includes(asin)) return;
  seeded.update(list => [...list, asin]);
  Object.entries(SEED_IMAGES).forEach(([id, image]) => {
    if (!images.get(id)) images.upsert({ id, contentType: image.contentType, asset: image.asset });
  });
  documents.upsert({
    id: newKey(),
    name: asin,
    status: 'APPROVED',
    brandName: SEED_BRAND,
    marketplaceId,
    asins: [asin],
    contentDocument: seedContentDocument(asin),
    updateTime: nowIso(Date.now() - 1000 * 60 * 60 * 24 * 12),
  });
}

export function metadataOf(doc: MockAplusDocument): AmazonContentMetadata {
  return {
    name: doc.name,
    marketplaceId: doc.marketplaceId,
    status: doc.status,
    badgeSet: ['STANDARD'],
    updateTime: doc.updateTime,
    brandName: doc.brandName,
  };
}

export function recordOf(doc: MockAplusDocument): AmazonContentRecord {
  return { contentReferenceKey: doc.id, contentMetadata: metadataOf(doc), contentDocument: doc.contentDocument };
}

/** Documentos del ASIN, del más reciente al más antiguo. */
export function documentsFor(asin: string): MockAplusDocument[] {
  return documents
    .all()
    .filter(doc => doc.name === asin || doc.asins.includes(asin))
    .map(doc => reviewed(doc))
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime));
}
