import { MARKETPLACE } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { aplusApi, errorBody } from '../api/aplusApi';
import { contentRecordOf, countDownloadedImages, mapAmazonModulesToUI } from '../model/amazon';
import type { AmazonContentDocument, AmazonMetadataRecord } from '../model/amazonTypes';
import { LOAD_TOAST_ID } from '../model/constants';
import { getModuleImage, normalizeModule, withModuleImage } from '../model/content';
import type { AplusDocument, AplusModule } from '../model/types';
import type { AplusRuntime } from './aplusRuntime';
import type { AplusState } from './aplusStore';

/**
 * Carga desde Amazon (APlusContentInterface.tsx 467-605): contenido publicado del
 * ASIN o, si no hay, su borrador; documentos del selector; Recargar; y las imágenes
 * de Amazon al volver a la pestaña desde la caché.
 */
const download = (rt: AplusRuntime) => (id: string | undefined) => rt.images.download(id);

// loadAplusContent (APlusContentInterface.tsx 491-605; E11, E20, A01, A08)
export async function loadAplusContent(rt: AplusRuntime): Promise<void> {
  const asin = rt.asin;
  if (!asin) return;
  const token = rt.token();
  const set = (patch: Partial<AplusState>) => {
    if (rt.live(token)) rt.store.setState(patch);
  };
  set({ loading: true });
  toast.loading('💼 Cargando contenido A+ e imágenes...', { id: LOAD_TOAST_ID });
  try {
    const listResponse = await aplusApi.listAplusDocuments({ asin, marketplace_id: MARKETPLACE.id });
    const filtered = listResponse?.filtered || [];
    let contentDocument: AmazonContentDocument | null = null;
    let brandName = '';
    let contentReferenceKey = '';
    let isPublished = false;
    let documents: AplusDocument[] | null = null;
    let documentKey = '';

    if (filtered.length > 0) {
      // Contenido PUBLICADO: queda como documento actual, así que guardar o
      // publicar actualiza ese contenido, como promete su aviso.
      const first = filtered[0];
      contentDocument = first?.payload?.contentRecord?.contentDocument || first?.contentRecord?.contentDocument || null;
      const metadata = first?.payload?.contentRecord?.contentMetadata || first?.contentRecord?.contentMetadata;
      brandName = metadata?.brandName || '';
      contentReferenceKey = first?.contentReferenceKey || '';
      isPublished = true;
      if (contentReferenceKey) {
        documents = [{ contentReferenceKey, contentMetadata: metadata || {} }];
        documentKey = contentReferenceKey;
      }
    } else {
      // BORRADORES
      const searchResponse = await aplusApi.searchAplusDocuments({ asin, marketplace_id: MARKETPLACE.id });
      const records: AmazonMetadataRecord[] = searchResponse?.payload?.contentMetadataRecords
        || searchResponse?.contentMetadataRecords
        || searchResponse?.body?.contentMetadataRecords
        || [];
      const asinDocuments = records.filter(doc => (doc?.contentMetadata?.name || '') === asin);
      documents = asinDocuments;
      if (records.length > 0) {
        const first = asinDocuments[0] || records[0];
        const crk = first?.contentReferenceKey || first?.contentMetadata?.contentReferenceKey;
        documentKey = crk || '';
        if (crk) {
          const detail = await aplusApi.getAplusDocumentDetail({ contentReferenceKey: crk, marketplace_id: MARKETPLACE.id });
          const contentRecord = contentRecordOf(detail);
          contentDocument = contentRecord?.contentDocument || null;
          brandName = contentRecord?.contentMetadata?.brandName || '';
          contentReferenceKey = crk;
          isPublished = false;
        }
      }
    }

    if (!contentDocument) {
      // Sin contenido: se limpia la caché para no usar la clave de otro ASIN.
      rt.cache.clear();
      set({ selectedDocumentKey: '', availableDocuments: [], hasUnsavedChanges: false, modules: [] });
      toast.info('No hay contenido A+ para este ASIN', { id: LOAD_TOAST_ID });
      return;
    }
    if (!contentDocument.contentModuleList) {
      set({ availableDocuments: documents || [], selectedDocumentKey: documentKey });
      toast.info('No hay contenido A+ para este ASIN', { id: LOAD_TOAST_ID });
      return;
    }

    if (contentReferenceKey) rt.cache.setStoredCrk(contentReferenceKey);
    const mappedModules = await mapAmazonModulesToUI(contentDocument.contentModuleList, download(rt));
    if (rt.live(token)) {
      rt.store.setState({
        brand: brandName,
        availableDocuments: documents || [],
        selectedDocumentKey: documentKey,
        hasUnsavedChanges: false,
        modules: mappedModules.map(normalizeModule),
      });
      rt.cache.schedule();
    }
    const imageCount = countDownloadedImages(mappedModules);
    if (isPublished) {
      toast.success(`✅ Contenido A+ PUBLICADO cargado: ${mappedModules.length} módulos`, {
        id: LOAD_TOAST_ID,
        description: `${imageCount} imágenes descargadas. Puedes editarlo y actualizará el contenido existente.`,
      });
    } else {
      toast.info(`📝 Borrador A+ cargado: ${mappedModules.length} módulos`, {
        id: LOAD_TOAST_ID,
        description: `${imageCount} imágenes descargadas. Este contenido está en borrador.`,
      });
    }
  } catch (error) {
    console.warn('Error loading A+ content:', error);
    toast.error(errorBody(error).error || 'Error al cargar A+ Content', { id: LOAD_TOAST_ID });
  } finally {
    set({ loading: false });
  }
}

// loadDocumentContent (APlusContentInterface.tsx 467-489; A08/E04)
export async function loadDocumentContent(rt: AplusRuntime, contentReferenceKey: string, previousKey: string): Promise<void> {
  const token = rt.token();
  rt.store.setState({ pendingDocumentKey: contentReferenceKey, loading: true });
  let loaded = false;
  try {
    const detail = await aplusApi.getAplusDocumentDetail({ contentReferenceKey, marketplace_id: MARKETPLACE.id });
    const contentRecord = contentRecordOf(detail);
    const contentDocument = contentRecord?.contentDocument;
    const brandName = contentRecord?.contentMetadata?.brandName || '';
    if (contentDocument?.contentModuleList) {
      rt.cache.setStoredCrk(contentReferenceKey);
      const mappedModules = await mapAmazonModulesToUI(contentDocument.contentModuleList, download(rt));
      if (rt.live(token)) {
        rt.store.setState({
          brand: brandName,
          selectedDocumentKey: contentReferenceKey,
          hasUnsavedChanges: false,
          modules: mappedModules.map(normalizeModule),
        });
        rt.cache.schedule();
      }
      loaded = true;
      toast.success(`Contenido cargado: ${mappedModules.length} módulos`);
    }
  } catch (error) {
    console.warn('Error loading document:', error);
  } finally {
    // Si no se pudo cargar, el selector vuelve al documento anterior.
    const patch: Partial<AplusState> = { pendingDocumentKey: null, loading: false };
    if (!loaded) {
      patch.selectedDocumentKey = previousKey;
      toast.error('Error al cargar documento');
    }
    if (rt.live(token)) rt.store.setState(patch);
  }
}

// Recargar (E06)
export function reloadAplus(rt: AplusRuntime): void {
  const state = rt.store.getState();
  if (state.loading || state.publishing) return;
  // «Recargar» trae de nuevo el contenido de Amazon; sin ASIN no hay nada que
  // traer, y vaciar la lista borraría los únicos módulos del producto.
  if (!rt.asin) {
    toast.info('Este producto aún no tiene ASIN: no hay contenido A+ de Amazon que recargar.');
    return;
  }
  rt.store.setState({ selectedDocumentKey: '', availableDocuments: [], hasUnsavedChanges: false, modules: [] });
  rt.cache.clear();
  rt.images.clear();
  void loadAplusContent(rt);
}

/** Huecos con imagen de un módulo: [índice de sección o null, imagen]. */
function imageSlots(module: AplusModule): [number | null, ReturnType<typeof getModuleImage>][] {
  if (module.type === 'four-images') return (module.content.sections || []).map((_, index) => [index, getModuleImage(module, index)]);
  return [[null, getModuleImage(module, null)]];
}

/** Pone la URL descargada en el hueco si sigue teniendo esa imagen (sin marcar cambios). */
function patchImageUrl(rt: AplusRuntime, moduleId: string, index: number | null, uploadDestinationId: string, url: string): void {
  rt.store.setState(state => ({
    modules: state.modules.map(module => {
      if (module.id !== moduleId) return module;
      const image = getModuleImage(module, index);
      if (!image || image.uploadDestinationId !== uploadDestinationId) return module;
      const content = module.type === 'header-image'
        ? { ...module.content, image: { ...image, url } }
        : withModuleImage(module, index, { ...image, url });
      return content ? ({ ...module, content } as AplusModule) : module;
    }),
  }));
}

// Restauración desde la caché con las imágenes pedidas de nuevo (E11 A, A02).
export async function restoreImages(rt: AplusRuntime, token: number): Promise<void> {
  const modules = rt.store.getState().modules;
  await Promise.all(modules.map(async module => {
    for (const [index, image] of imageSlots(module)) {
      const id = image?.uploadDestinationId;
      if (!id) continue;
      const url = await rt.images.download(id);
      if (!url || !rt.live(token)) continue;
      patchImageUrl(rt, module.id, index, id, url);
    }
  }));
}
