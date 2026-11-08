import { MARKETPLACE } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { aplusApi, errorBody, type SavePayload, type SaveResponse } from '../api/aplusApi';
import { mapModulesToBackend } from '../model/backend';
import type { AplusDocument, SaveOperation } from '../model/types';
import type { AplusRuntime } from './aplusRuntime';
import type { AplusState } from './aplusStore';

/**
 * Guardado y publicación (handleSaveOperation, APlusContentInterface.tsx 652-746;
 * E20/E21): «Guardar borrador», «Guardar y enlazar» y «Publicar en Amazon».
 */
const CONFIG: Record<SaveOperation, { toastId: string; loadingMsg: string; apiCall: ((data: SavePayload) => Promise<SaveResponse>) | null }> = {
  link: { toastId: 'save-link-toast', loadingMsg: '📤 Guardando y enlazando...', apiCall: aplusApi.createAndLinkAplusDocument },
  publish: { toastId: 'save-publish-toast', loadingMsg: '📤 Guardando y publicando...', apiCall: aplusApi.createAndPublishAplusDocument },
  draft: { toastId: 'save-draft-toast', loadingMsg: '📤 Guardando borrador...', apiCall: null },
};

const SUCCESS: Record<SaveOperation, (crk: string) => { msg: string; desc: string; duration: number }> = {
  link: crk => ({ msg: '✅ Contenido A+ enlazado al ASIN!', desc: `Listo para enviar a revisión. ID: ${crk.substring(0, 8)}...`, duration: 6000 }),
  publish: crk => ({ msg: '✅ Contenido A+ enviado a revisión!', desc: `Amazon revisará el contenido. ID: ${crk.substring(0, 8)}...`, duration: 8000 }),
  draft: crk => ({ msg: '✅ Borrador guardado!', desc: `ID: ${crk.substring(0, 8)}... Guardado sin enlazar`, duration: 6000 }),
};

const FAILURE: Record<SaveOperation, string> = { link: 'Error al enlazar', publish: 'Error al publicar', draft: 'Error al guardar' };

export async function saveAplus(rt: AplusRuntime, operation: SaveOperation): Promise<void> {
  const state = rt.store.getState();
  if (state.publishing || state.loading) return;
  const asin = rt.asin;
  if (!asin) {
    toast.error('Se requiere un ASIN');
    return;
  }
  const finalBrand = state.brand || rt.productBrand() || 'Generic';
  if (state.modules.length === 0) {
    toast.error('Agrega al menos un módulo');
    return;
  }

  const config = CONFIG[operation];
  const token = rt.token();
  rt.store.setState({ publishing: true });
  toast.loading(config.loadingMsg, { id: config.toastId });
  const versionAtStart = rt.editVersion();
  let settled = false;
  try {
    const modules = mapModulesToBackend(state.modules);
    const existingCRK = state.availableDocuments.length > 0 ? (state.selectedDocumentKey || rt.cache.storedCrk()) : null;
    const base = { asin, marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode, modules };
    let response: SaveResponse;
    let crk: string | undefined;
    if (operation === 'draft') {
      if (existingCRK) {
        response = await aplusApi.updateAplusDocument({ contentReferenceKey: existingCRK, ...base });
        crk = existingCRK;
      } else {
        response = await aplusApi.createAplusDocument({ ...base, brand: finalBrand });
        crk = (response?.body || response)?.contentReferenceKey;
      }
    } else {
      const payload: SavePayload = existingCRK ? { contentReferenceKey: existingCRK, ...base } : { ...base, brand: finalBrand };
      response = await (config.apiCall as (data: SavePayload) => Promise<SaveResponse>)(payload);
      crk = (response?.body || response)?.contentReferenceKey || existingCRK || undefined;
    }

    if (crk) {
      const key = String(crk);
      rt.cache.setStoredCrk(key);
      const unchanged = rt.editVersion() === versionAtStart;
      const live = rt.live(token);
      const newDocument: AplusDocument | null = !existingCRK && operation !== 'link'
        ? { contentReferenceKey: key, contentMetadata: { name: asin, status: 'DRAFT' } }
        : null;
      // Solo se borra la caché si no se editó durante la petición; si se editó y
      // la pestaña ya se cerró, la entrada (con esas ediciones) se conserva y se
      // apunta al documento guardado.
      if (unchanged) rt.cache.removeContent();
      else if (!live) rt.cache.pointTo(key, newDocument);
      if (live) {
        const patch: Partial<AplusState> = { selectedDocumentKey: key };
        if (unchanged) patch.hasUnsavedChanges = false;
        if (newDocument) patch.availableDocuments = [newDocument];
        rt.store.setState(patch);
        if (!unchanged) rt.cache.schedule();
      }
      const warnings = (response?.body || response)?.warnings || [];
      if (warnings.length > 0) {
        const warning = warnings.find(item => item.step === operation) || warnings.find(item => item.step === 'link');
        if (warning) {
          toast.warning(warning.message, { id: config.toastId, description: `ID: ${key.substring(0, 8)}... - ${warning.details}`, duration: 10000 });
          settled = true;
        }
      } else {
        const success = SUCCESS[operation](key);
        if (operation !== 'draft' && live) rt.store.setState({ isLinkedToAsin: true });
        toast.success(success.msg, { id: config.toastId, description: success.desc, duration: success.duration });
        settled = true;
      }
    }
  } catch (error) {
    console.warn('❌ Error:', errorBody(error));
    const data = errorBody(error);
    toast.error(data.error || FAILURE[operation], {
      id: config.toastId,
      description: data.details ? JSON.stringify(data.details).substring(0, 200) : undefined,
    });
    settled = true;
  } finally {
    if (!settled) toast.dismiss(config.toastId);
    if (rt.live(token)) rt.store.setState({ publishing: false });
  }
}
