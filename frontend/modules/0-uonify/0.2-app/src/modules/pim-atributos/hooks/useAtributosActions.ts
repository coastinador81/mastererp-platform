import { USE_MOCKS } from '@/shared/api/config';
import { askProductAssistant } from '@/shared/pim';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { NEW_PRODUCT_KEY, pimStore, usePimScope, type PimEdited, type PimTabContext } from '@/shared/pim';
import { useLatest } from '@/shared/hooks';
import { toast } from '@/shared/ui';
import { generateTitle } from '../api/atributosApi';
import { syncChannels } from '../api/channelSync';
import { hasUnconfirmed } from '../model/fields';
import { activeChannels, buildDataToSave, buildProductToCreate, currentValues, newProductDraft } from '../model/productValues';
import { sheetShowsProduct } from '../model/sheet';
import { memory } from './atributosMemory';
import type { CustomFieldsApi } from './useCustomFields';

/**
 * Acciones de la pestaña Atributos (prototipo: pim/atributos.js): título con
 * Uony (creación, edición y botón «IA» de un campo), «Crear Producto»
 * (handleCreateProduct, E18) y «Guardar Cambios» (handleSaveChanges, E32).
 */

const errorText = (error: unknown) => (error instanceof Error ? error.message : '');
const trimmed = (value: unknown) => String(value ?? '').trim();

export function useAtributosActions(ctx: PimTabContext, fieldsApi: CustomFieldsApi, saveButtonRef: RefObject<HTMLButtonElement | null>) {
  const scope = usePimScope();
  const latest = useLatest({ ctx, fieldsApi });
  const mounted = useRef(false);
  const savingRef = useRef(false);
  const refocusSave = useRef(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Tras guardar, la ficha se vuelve a pintar: el foco vuelve a «Guardar Cambios».
  useLayoutEffect(() => {
    if (!refocusSave.current || saving) return;
    refocusSave.current = false;
    saveButtonRef.current?.focus();
  });

  const edited = (): PimEdited => scope.get<PimEdited>('edited', {}) || {};
  const editName = (title: string) => latest.current.ctx.edit({ name: title });

  async function runTitle(input: Record<string, unknown>, apply: (title: string) => void) {
    if (!USE_MOCKS) {
      askProductAssistant(ctx.product ? `Mejora y guarda el nombre del producto ${ctx.product.sku} usando sus datos confirmados.` : `Ayúdame a definir el nombre de un producto a partir de estos datos: ${JSON.stringify(input)}. Pregúntame por los datos que falten antes de crearlo.`);
      return;
    }
    try {
      toast.info('Generando título con Uony...');
      const title = await generateTitle(input);
      if (title) {
        apply(title);
        toast.success('✅ Título generado con Uony');
      }
    } catch (error) {
      toast.error(errorText(error) || '❌ Error generando título');
    }
  }

  /** ProductForm.handleGenerateTitle (creación). */
  async function generateTitleCreate() {
    const d = newProductDraft(edited());
    if (!d.name && !d.brand) {
      toast.warning('⚠️ Agrega al menos un nombre o marca para generar el título');
      return;
    }
    setGeneratingTitle(true);
    await runTitle(d, editName);
    if (mounted.current) setGeneratingTitle(false);
  }

  /** «Nombre del Producto» (edición): usa la marca y la categoría que se ven (E20). */
  async function generateTitleEdit() {
    const values = currentValues(edited(), ctx.product);
    await runTitle({ name: edited().name || ctx.product?.name || 'Producto', brand: values.brand || '', category: values.category || '' }, editName);
  }

  /** Botón «IA» del nombre de un campo (solo creación): usa la categoría del producto que se crea (E12/A02). */
  async function generateFieldTitle(id: string) {
    const fields = fieldsApi.read();
    const field = fields.find(item => item.id === id);
    if (!field) return;
    if (!USE_MOCKS) {
      askProductAssistant(`Ayúdame con el atributo «${field.name}»${ctx.product ? ` de ${ctx.product.sku}` : ' del producto que estoy preparando'}. Propón un valor usando solo datos confirmados; no cambies el nombre del producto ni inventes características.`);
      return;
    }
    await runTitle({
      name: field.value || 'Producto',
      brand: fields.find(item => String(item.name || '').toLowerCase().includes('marca'))?.value || '',
      category: newProductDraft(edited()).category || '',
    }, title => latest.current.fieldsApi.updateField(id, { value: title }));
  }

  async function createProduct() {
    const draftEdited = edited();
    const d = newProductDraft(draftEdited);
    const fields = fieldsApi.read();
    if (!trimmed(d.name) || !trimmed(d.sku) || (fields.length > 0 && hasUnconfirmed(fields))) return;
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    let saved;
    try {
      saved = await ctx.persist(buildProductToCreate(draftEdited, fields), { create: true });
    } catch (error) {
      toast.error(errorText(error) || 'No se pudo crear el producto');
      return;
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
    // Se vacía el formulario de creación: el borrador movido al SKU nuevo ya es el producto.
    if (pimStore.get(saved.sku, 'edited') === draftEdited) pimStore.set(saved.sku, 'edited', {});
    memory.drop(NEW_PRODUCT_KEY);
  }

  async function saveChanges() {
    const selected = ctx.product;
    if (!ctx.key || !selected) {
      toast.error('No hay producto seleccionado para guardar');
      return;
    }
    const fields = fieldsApi.read();
    const pending = fields.filter(field => !field.isConfirmed).length;
    if (pending > 0) {
      toast.error(`Confirma todos los campos personalizados antes de guardar (${pending} pendientes)`);
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const pendingEdits = edited();
    const editedData = { ...pendingEdits };
    try {
      let header: Record<string, boolean> = {};
      try { header = ctx.channels?.() || {}; } catch { header = {}; }
      const channels = activeChannels(header, selected);
      const dataToSave = buildDataToSave({ product: selected, edited: editedData, fields, bullets: scope.get('bullets'), gallery: scope.get('images') });
      // El guardado local rechaza nombre o SKU vacíos: se comprueba antes de enviar nada a los canales.
      if (!trimmed(dataToSave.name) || !trimmed(dataToSave.sku)) throw new Error('El nombre y el SKU son obligatorios.');
      if (typeof ctx.skuTaken === 'function' && ctx.skuTaken(String(dataToSave.sku))) throw new Error('Este SKU ya pertenece a otro producto.');
      await syncChannels({ channels, selected, edited: editedData, dataToSave });
      const now = latest.current.ctx;
      if (!sheetShowsProduct(now, now.product ?? selected, mounted.current)) {
        toast.error('❌ Error al guardar producto', { description: 'Los cambios no se guardaron localmente: la ficha ya muestra otro producto.' });
        return;
      }
      // Se guarda en el producto con el que empezó el guardado, aunque ahora haya otro abierto.
      const saved = await ctx.persist({
        ...dataToSave,
        bullets: dataToSave.bullet_points,
        stock_data: (now.product ?? selected).stock_data || dataToSave.stock_data,
      }, { key: selected.sku });
      if (!channels.shopify && !channels.amazon) toast.success(USE_MOCKS ? '✅ Cambios guardados localmente' : 'Cambios guardados en tu cuenta');
      if (pimStore.get(saved.sku, 'edited') === pendingEdits) pimStore.set(saved.sku, 'edited', {});
      if (mounted.current && saved.sku === latest.current.ctx.key) refocusSave.current = true;
    } catch (error) {
      const message = errorText(error);
      toast.error('❌ Error al guardar producto', message ? { description: message } : undefined);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return {
    generatingTitle,
    saving,
    generateTitle: () => void (ctx.isNew ? generateTitleCreate() : generateTitleEdit()),
    generateFieldTitle: (id: string) => void generateFieldTitle(id),
    createProduct: () => void createProduct(),
    saveChanges: () => void saveChanges(),
  };
}
