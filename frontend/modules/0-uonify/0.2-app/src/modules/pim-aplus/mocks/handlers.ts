import { http } from 'msw';
import { MARKETPLACE } from '@/shared/api/config';
import { HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { APLUS_ENDPOINTS, type GeneratePayload, type SavePayload, type UploadToS3Payload } from '../api/aplusApi';
import { countMissingImages } from '../model/backend';
import { ALLOWED_IMAGE_FORMATS, TO } from '../model/constants';
import { base64ToBytes, bytesToBase64, hexToBase64, md5Hex } from '../model/md5';
import type { SaveOperation } from '../model/types';
import {
  destinations,
  documents,
  documentsFor,
  ensureSeeded,
  images,
  metadataOf,
  newKey,
  nowIso,
  recordOf,
  reviewed,
  type MockAplusDocument,
} from './aplusDb';
import { readModules, toContentDocument } from './convert';
import { generateAplusCopy } from './generator';

/**
 * Simulación del backend A+ (SP-API A+ Content a través de Uonify): documentos
 * por ASIN, borradores, enlace y envío a revisión, subida de imágenes con MD5 y
 * generación con Uony. Éxito por defecto, con latencia realista.
 */
const wait = (ms: number) => latency(import.meta.env.MODE === 'test' ? 0 : ms);
// El frontend muestra `error` tal cual (como el original): va en español.
const failure = (status: number, message: string, error = message) => HttpResponse.json({ error, message }, { status });

const queryOf = (request: Request) => new URL(request.url).searchParams;

async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    return ((await request.json()) ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

/** Crea o actualiza el documento de un guardado; null si falta algo. */
function upsertDocument(body: Partial<SavePayload>): { doc: MockAplusDocument } | { status: number; message: string } {
  const modules = readModules(body.modules);
  if (!body.asin) return { status: 400, message: 'Se requiere un ASIN' };
  if (!modules || modules.length === 0) return { status: 400, message: 'El documento A+ necesita al menos un módulo' };
  if (modules.length > 5) return { status: 400, message: 'Amazon admite como máximo 5 módulos en A+ básico' };
  const contentDocument = toContentDocument(body.asin, modules);
  if (body.contentReferenceKey) {
    const existing = documents.get(body.contentReferenceKey);
    if (!existing) return { status: 404, message: 'Documento A+ no encontrado' };
    const doc = documents.patch(existing.id, { contentDocument, status: 'DRAFT', submittedAt: undefined, updateTime: nowIso() });
    return { doc: doc as MockAplusDocument };
  }
  const doc: MockAplusDocument = {
    id: newKey(),
    name: body.asin,
    status: 'DRAFT',
    brandName: body.brand || 'Generic',
    marketplaceId: body.marketplace_id || MARKETPLACE.id,
    asins: [],
    contentDocument,
    updateTime: nowIso(),
  };
  return { doc: documents.upsert(doc) };
}

/** Guardar y enlazar / Guardar y publicar: sin imágenes subidas, Amazon no lo acepta (aviso). */
function saveAnd(operation: Exclude<SaveOperation, 'draft'>) {
  return async ({ request }: { request: Request }) => {
    const body = await readJson<SavePayload>(request);
    await wait(operation === 'publish' ? 1400 : 1100);
    const result = upsertDocument(body);
    if ('status' in result) return failure(result.status, result.message);
    const { doc } = result;
    const missing = countMissingImages(readModules(body.modules) ?? []);
    if (missing > 0) {
      return HttpResponse.json({
        contentReferenceKey: doc.id,
        warnings: [{
          step: operation,
          message: operation === 'publish' ? 'Contenido guardado, pero no se ha enviado a revisión' : 'Contenido guardado, pero no se ha enlazado al ASIN',
          details: `Faltan imágenes subidas a Amazon en ${missing} módulo${missing !== 1 ? 's' : ''}`,
        }],
      });
    }
    const asins = doc.asins.includes(doc.name) ? doc.asins : [...doc.asins, doc.name];
    documents.patch(doc.id, operation === 'publish' ? { asins, status: 'SUBMITTED', submittedAt: Date.now() } : { asins });
    return HttpResponse.json({ contentReferenceKey: doc.id, warnings: [] });
  };
}

async function assetBase64(path: string): Promise<string | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

export const handlers = [
  // Contenido publicado del ASIN
  http.get(mock(APLUS_ENDPOINTS.list), async ({ request }) => {
    const query = queryOf(request);
    const asin = query.get('asin') || '';
    await wait(700);
    if (!asin) return failure(400, 'Se requiere un ASIN');
    ensureSeeded(asin, query.get('marketplace_id') || MARKETPLACE.id);
    const filtered = documentsFor(asin)
      .filter(doc => doc.status === 'APPROVED' && doc.asins.includes(asin))
      .map(doc => ({ contentReferenceKey: doc.id, contentRecord: recordOf(doc) }));
    return HttpResponse.json({ filtered });
  }),

  // Documentos del ASIN (borradores y envíos)
  http.get(mock(APLUS_ENDPOINTS.search), async ({ request }) => {
    const query = queryOf(request);
    const asin = query.get('asin') || '';
    await wait(500);
    if (!asin) return failure(400, 'Se requiere un ASIN');
    ensureSeeded(asin, query.get('marketplace_id') || MARKETPLACE.id);
    const contentMetadataRecords = documentsFor(asin).map(doc => ({ contentReferenceKey: doc.id, contentMetadata: metadataOf(doc) }));
    return HttpResponse.json({ contentMetadataRecords });
  }),

  http.get(mock(APLUS_ENDPOINTS.detail), async ({ request }) => {
    const key = queryOf(request).get('contentReferenceKey') || '';
    await wait(450);
    const doc = documents.get(key);
    if (!doc) return failure(404, 'Documento A+ no encontrado');
    return HttpResponse.json({ contentRecord: recordOf(reviewed(doc)) });
  }),

  // La misma ruta atiende dos consultas: ?uploadDestinationId= (A+, aquí) y ?url=
  // (pim-imagenes). Sin uploadDestinationId se deja pasar al siguiente handler.
  http.get(mock(APLUS_ENDPOINTS.imageProxy), async ({ request }) => {
    const id = queryOf(request).get('uploadDestinationId') || '';
    if (!id) return undefined;
    await wait(300);
    const stored = images.get(id);
    const image = stored?.image ?? (stored?.asset ? await assetBase64(stored.asset) : null);
    if (!stored || !image) return failure(404, 'La imagen no está disponible', 'IMAGE_NOT_ACCESSIBLE');
    return HttpResponse.json({ image, contentType: stored.contentType });
  }),

  http.post(mock(APLUS_ENDPOINTS.create), async ({ request }) => {
    const body = await readJson<SavePayload>(request);
    await wait(900);
    const result = upsertDocument({ ...body, contentReferenceKey: undefined });
    if ('status' in result) return failure(result.status, result.message);
    return HttpResponse.json({ contentReferenceKey: result.doc.id, warnings: [] });
  }),

  http.put(mock(APLUS_ENDPOINTS.update), async ({ request }) => {
    const body = await readJson<SavePayload>(request);
    await wait(900);
    if (!body.contentReferenceKey) return failure(400, 'Falta el documento A+ que actualizar');
    const result = upsertDocument(body);
    if ('status' in result) return failure(result.status, result.message);
    return HttpResponse.json({ contentReferenceKey: result.doc.id, warnings: [] });
  }),

  http.post(mock(APLUS_ENDPOINTS.createLink), saveAnd('link')),
  http.post(mock(APLUS_ENDPOINTS.createPublish), saveAnd('publish')),

  // Reserva de destino de subida (Amazon pide el MD5 en hexadecimal)
  http.post(mock(APLUS_ENDPOINTS.uploadDestination), async ({ request }) => {
    const body = await readJson<{ contentType: string; contentMD5: string }>(request);
    await wait(400);
    const contentType = body.contentType || '';
    if (!ALLOWED_IMAGE_FORMATS.includes(contentType)) return failure(400, 'Formato no permitido. Use .jpg, .png o .bmp');
    if (!/^[0-9a-f]{32}$/i.test(body.contentMD5 || '')) return failure(400, 'Falta el MD5 del archivo');
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/bmp' ? 'bmp' : 'jpg';
    const key = `sc/${newKey()}.${ext}`;
    const url = `https://aplus-media.s3.amazonaws.com/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900`;
    const id = `aplus-media/${key}`;
    const md5 = (body.contentMD5 as string).toLowerCase();
    destinations.upsert({ id, url, contentType, contentMD5: md5, createdAt: Date.now() });
    return HttpResponse.json({
      uploadDestinationId: id,
      url,
      headers: { 'Content-Type': contentType, 'Content-MD5': hexToBase64(md5), 'x-amz-server-side-encryption': 'AES256' },
    });
  }),

  // Subida a S3 a través del backend (Amazon comprueba el MD5 en base64)
  http.post(mock(APLUS_ENDPOINTS.uploadToS3), async ({ request }) => {
    const body = await readJson<UploadToS3Payload>(request);
    await wait(900);
    const destination = destinations.all().find(item => item.url === body.uploadUrl);
    if (!destination) return failure(404, 'El destino de subida no existe o ha caducado');
    if (!body.fileContent) return failure(400, 'El archivo está vacío');
    const md5 = md5Hex(base64ToBytes(body.fileContent));
    if (md5 !== destination.contentMD5 || hexToBase64(md5) !== body.contentMD5) return failure(400, 'La suma MD5 no coincide con el archivo');
    images.upsert({ id: destination.id, contentType: destination.contentType, image: body.fileContent });
    destinations.remove(destination.id);
    return HttpResponse.json({ success: true });
  }),

  // Generación con Uony (titular y cuerpo de la superposición de texto)
  http.post(mock(APLUS_ENDPOINTS.generate), async ({ request }) => {
    const body = await readJson<GeneratePayload>(request);
    await wait(2500);
    if (!body.product) return failure(400, 'Faltan los datos del producto');
    const { headline, bodyText } = generateAplusCopy(body.product);
    const limits = body.limits || { headline: TO.headline, body: TO.body };
    return HttpResponse.json({ headline: headline.slice(0, limits.headline || TO.headline), bodyText: bodyText.slice(0, limits.body || TO.body) });
  }),
];
