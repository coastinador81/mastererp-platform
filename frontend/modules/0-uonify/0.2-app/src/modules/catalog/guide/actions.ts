import { api, errorMessage } from '@/shared/api/client';
import { pimStore } from '@/shared/pim';
import { seedSampleSlices } from '../model/sampleSeeding';
import { useCatalogStore } from '../hooks/useCatalogStore';
import type { CatalogProduct } from '../model/types';
import { amazonPublicationUrl, publicationMessage } from './publication';
import { cacheGuideProduct, editGuideProduct, fingerprint, guideDraft, guideSnapshot } from './draft';
import { GUIDE_SKU, editFromText, normalise, publicationApproved, type GuidePrepared, type GuideSource } from './model';
import { guideEpoch, guideOf, newGuide, patchGuide } from './store';

export interface GuideReply { text: string; openProduct?: boolean; spoken?: string }
const say = (text: string, spoken = text): GuideReply => ({ text, spoken });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const tasks = new Map<string, symbol>();
export function pauseGuide(id: string): void {
  if (!guideOf(id)) return;
  tasks.delete(id);
  patchGuide(id, { paused: true, busy: false });
}

async function prepare(id: string): Promise<GuideReply> {
  const epoch = guideEpoch;
  const token = Symbol();
  tasks.set(id, token);
  const alive = () => epoch === guideEpoch && tasks.get(id) === token && !guideOf(id)?.paused;
  patchGuide(id, { step: 'preparing', progress: 0, busy: false, paused: false });
  const prepared = await api.post<GuidePrepared>('/product-guides/prepare', { threadId: id });
  if (!alive()) return say('He pausado la preparación. Puedes retomarla cuando quieras.');
  cacheGuideProduct(prepared.product);
  patchGuide(id, { sku: prepared.product.sku, progress: 1 });
  // Las porciones son las mismas que consume el módulo. Nunca sobrescribir ediciones manuales.
  seedSampleSlices(pimStore.scope(prepared.product.sku), prepared.sample);
  for (let progress = 2; progress <= 4; progress += 1) {
    await sleep(450);
    if (!alive()) return say('He pausado la preparación. El borrador está conservado.');
    patchGuide(id, { progress });
  }
  tasks.delete(id);
  patchGuide(id, { step: 'ready', progress: 4 });
  return say('La ficha está preparada con sus imágenes, contenido A+ y vídeo. Puedes pedirme la vista previa o abrir el mismo borrador en Producto.', 'La ficha está preparada. ¿Quieres ver cómo quedará en Amazon?');
}

async function publish(id: string): Promise<GuideReply> {
  const guide = guideOf(id);
  if (!guide?.reviewed || guide.reviewed !== fingerprint(guide.sku)) {
    patchGuide(id, { step: 'ready', reviewed: undefined });
    return say('La ficha ha cambiado o aún no la has revisado. Abre la vista previa actual antes de aprobar la publicación.');
  }
  const epoch = guideEpoch;
  const approved = guide.reviewed;
  if (guide.published === approved) {
    patchGuide(id, { step: 'published' });
    return say(publicationMessage(amazonPublicationUrl(guide.publicationUrl)));
  }
  const snapshot = guideSnapshot(guide.sku);
  patchGuide(id, { step: 'publishing', busy: true });
  const result = await api.post<{ product: CatalogProduct; status: string; publicationUrl?: string }>('/product-guides/publish', {
    threadId: id, ...snapshot, approvalId: approved,
  });
  if (epoch !== guideEpoch) return say('');
  if (result.status !== 'published') {
    patchGuide(id, { step: 'ready', busy: false });
    return say('Amazon está procesando la publicación. Todavía no tengo confirmación de que esté visible.');
  }
  const publicationUrl = amazonPublicationUrl(result.publicationUrl);
  const changed = fingerprint(guide.sku) !== approved;
  cacheGuideProduct(result.product);
  useCatalogStore.getState().setChannel(guide.sku || GUIDE_SKU, 'Amazon', true);
  patchGuide(id, { step: changed ? 'ready' : 'published', busy: false, published: approved, publicationUrl, reviewed: changed ? undefined : approved });
  return say(changed
    ? 'Se ha publicado la versión aprobada. Tus cambios posteriores siguen en el borrador y necesitan otra revisión.'
    : publicationMessage(publicationUrl));
}

/** Motor local del recorrido: el contrato real y los límites están en docs/EXPERIENCIA-UONY-AMAZON.md. */
export async function handleGuideText(id: string, text: string): Promise<GuideReply> {
  const existing = guideOf(id);
  if (!existing) {
    newGuide(id);
    return say('Vamos a preparar tu producto para Amazon. Primero conecta la cuenta de vendedor con la que quieres publicarlo.', 'Primero conecta tu cuenta de vendedor de Amazon.');
  }
  const value = normalise(text);
  if (/^(para|pausa|detente|cancelar|pausar)[.!]?$/.test(value)) {
    if (existing.step === 'publishing') return say('El envío ya está en curso. Conservaré el resultado; detener la voz no retira una publicación enviada.');
    pauseGuide(id);
    return say('He pausado el trabajo. Tu borrador sigue disponible en Producto.');
  }
  if (/abr[ei]|mostrar|ver|ir/.test(value) && /modulo|producto directamente/.test(value)) {
    return existing.sku ? { text: 'Aquí tienes el mismo borrador. Puedes editarlo y volver a la conversación cuando quieras.', openProduct: true }
      : say('En cuanto identifiquemos los archivos tendrás el borrador disponible en Producto.');
  }
  if (existing.busy || existing.step === 'preparing' && !existing.paused) return say('Sigo trabajando en la ficha. Puedes pausar la preparación o abrir el módulo de Producto.');
  if (existing.paused && !/continua|retoma|reanuda/.test(value)) return say('El trabajo está pausado. Dime «continúa» para retomarlo.');
  const epoch = guideEpoch;
  patchGuide(id, { error: '', paused: false });
  try {
    if (existing.paused && existing.step === 'preparing') return await prepare(id);
    if (existing.paused) return say('Continuamos desde donde lo dejamos.');
    if (existing.step === 'amazon' || existing.step === 'drive') {
      const provider = existing.step;
      if (!/^(?:conectar|conecta|autorizar|autorizo|continuar con) (?:amazon|google drive)[.!]?$/.test(value)) {
        return say(provider === 'amazon' ? 'Pulsa «Conectar Amazon» para autorizar tu cuenta de vendedor.' : 'Conecta Google Drive para que pueda acceder a la carpeta que elijas.');
      }
      if (provider === 'amazon' && !value.includes('amazon') || provider === 'drive' && !value.includes('drive')) return say('Completa primero la conexión que aparece en la tarjeta.');
      patchGuide(id, { busy: true });
      const connection = await api.post<{ connected: boolean }>(`/product-guides/connections/${provider}`, { threadId: id });
      if (!connection.connected) throw new Error('La conexión no se ha autorizado. Puedes volver a intentarlo.');
      if (epoch !== guideEpoch) return say('');
      patchGuide(id, { step: provider === 'amazon' ? 'drive' : 'folder', busy: false });
      return provider === 'amazon'
        ? say('Amazon está conectado. ¿Dónde tienes los archivos del producto? Puedes conectar Google Drive aquí mismo.')
        : say('Google Drive está conectado. ¿En qué carpeta tienes el producto?', '¿En qué carpeta de Google Drive tienes el producto?');
    }
    if (existing.step === 'folder') {
      patchGuide(id, { busy: true });
      const source = await api.post<GuideSource>('/product-guides/source', { threadId: id, folder: text });
      if (epoch !== guideEpoch) return say('');
      patchGuide(id, { step: 'files', folder: source.folder, busy: false });
      return say('He localizado Make It Possible de Uonify: datos del producto, ocho imágenes, contenido A+ y un vídeo. ¿Preparo la ficha con estos archivos?', 'He localizado el juego de Uonify y sus archivos. ¿Preparo la ficha?');
    }
    if (existing.step === 'files') {
      if (/^(si|vale|adelante|prepara|preparar|continua)/.test(value) && !value.includes('no ')) return await prepare(id);
      if (/otra carpeta|cambiar carpeta/.test(value)) { patchGuide(id, { step: 'folder' }); return say('Indícame la carpeta que quieres utilizar.'); }
      return say('Revisa los archivos de la tarjeta y dime «prepara la ficha» para continuar.');
    }
    const patch = editFromText(text);
    if (patch && existing.sku) {
      editGuideProduct(patch, existing.sku);
      patchGuide(id, { step: 'ready', reviewed: undefined });
      return say(patch.price ? `He cambiado el precio a ${String(patch.price).replace('.', ',')} €. Revisa la ficha antes de publicar los cambios.`
        : 'He actualizado el título en el borrador. Revisa la ficha antes de publicar los cambios.');
    }
    if (publicationApproved(text)) return await publish(id);
    if (/vista previa|como (va a )?quedar|muestra.*ficha|ver.*ficha|revisar/.test(value)) {
      if (!guideDraft(existing.sku)) return say('Espera a que se cargue el borrador antes de revisarlo.');
      patchGuide(id, { step: 'preview', reviewed: fingerprint(existing.sku) });
      return value.startsWith('revisar')
        ? say('Esta es la versión actual de tu ficha. Puedes pedir cambios o decir «aprobado, súbelo».', 'Revisa tu ficha. ¿Quieres cambiar algo o aprobar la publicación?')
        : say('La vista previa está lista. Pulsa «Ver vista previa» para abrir la ficha completa con sus imágenes, vídeo y contenido A+.', 'La vista previa está lista. Ábrela con el botón para revisar tu producto.');
    }
    return say('Puedes pedirme «muéstrame la vista previa», «cambia el precio a 29,90» o «cambia el título a…». Para otras ediciones, abre el mismo borrador en Producto.');
  } catch (error) {
    if (epoch !== guideEpoch) return say('');
    const message = errorMessage(error);
    patchGuide(id, { busy: false, error: message, step: existing.step === 'publishing' ? 'ready' : existing.step });
    return say(`${message} Tus datos se conservan; puedes volver a intentarlo.`);
  }
}
