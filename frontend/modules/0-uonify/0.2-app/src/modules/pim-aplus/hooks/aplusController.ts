import type { PimProduct, PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { aplusApi } from '../api/aplusApi';
import { handleImageUploadWithToast } from '../api/imageUpload';
import { TO } from '../model/constants';
import {
  addBlock,
  addBullet,
  applyField,
  createModule,
  getModuleImage,
  normalizeModule,
  releaseBlob,
  removeBlock,
  removeBullet,
  str,
  uploadTarget,
  withModuleImage,
  type FieldPath,
} from '../model/content';
import { buildSuggestedImage, getProductEcosystemData, readEcosystemSources, toGenerateProductInfo, type EcosystemData } from '../model/ecosystem';
import type { AplusCacheData, AplusModule, EditableModuleType, ModuleContent, SaveOperation, SpecsContent } from '../model/types';
import { validateModule } from '../model/validation';
import { AplusCache } from './aplusCache';
import { createImageDownloads } from './aplusImages';
import { loadAplusContent, loadDocumentContent, reloadAplus, restoreImages } from './aplusLoader';
import type { AplusRuntime } from './aplusRuntime';
import { saveAplus } from './aplusSaver';
import { createAplusStore } from './aplusStore';

export interface AplusTabSource {
  product: PimProduct | null;
  draft: () => Record<string, unknown>;
}

export interface AplusControllerOptions {
  asin?: string;
  /** Ámbito del producto en el almacén (ctx.store): sigue al producto si se renombra. */
  scope: PimScope;
  /** Contexto vigente de la pestaña (producto y ediciones). */
  source: () => AplusTabSource;
}

/**
 * Lógica de la pestaña A+ montada (APlusContentInterface y los tres editores del
 * original) sobre un almacén zustand. `start()` al montar, `stop()` al desmontar.
 */
export class AplusController implements AplusRuntime {
  readonly store = createAplusStore();
  readonly asin: string | undefined;
  readonly cache: AplusCache;
  readonly images = createImageDownloads();
  private session = 0;
  private alive = false;
  private edits = 0;

  constructor(private readonly options: AplusControllerOptions) {
    this.asin = options.asin || undefined;
    this.cache = new AplusCache(options.scope, this.asin, () => this.cacheData(), () => this.alive);
  }

  /* ----------------------------------------------------------- ciclo de vida */
  token(): number {
    return this.session;
  }

  live(token: number): boolean {
    return this.alive && token === this.session;
  }

  editVersion(): number {
    return this.edits;
  }

  productBrand(): string | undefined {
    const brand = this.options.source().product?.brand;
    return typeof brand === 'string' && brand ? brand : undefined;
  }

  /** Al montar: restaura la caché (A02) o carga desde Amazon (A01: nunca módulos de otro producto). */
  start(): void {
    this.session += 1;
    this.alive = true;
    const cached = this.cache.load();
    if (cached && Array.isArray(cached.modules)) {
      this.store.setState({
        brand: cached.brand || '',
        hasUnsavedChanges: cached.hasUnsavedChanges ?? true,
        availableDocuments: Array.isArray(cached.availableDocuments) ? cached.availableDocuments : [],
        selectedDocumentKey: cached.selectedDocumentKey || '',
        modules: cached.modules.map(normalizeModule),
      });
      this.cache.schedule();
      void restoreImages(this, this.session);
    } else {
      void loadAplusContent(this);
    }
  }

  /** Al desmontar: vuelca la caché pendiente y deja sin efecto lo que aún esté en curso. */
  stop(): void {
    this.cache.flush();
    this.alive = false;
    this.session += 1;
  }

  private cacheData(): AplusCacheData {
    const { modules, brand, hasUnsavedChanges, availableDocuments, selectedDocumentKey } = this.store.getState();
    return { modules, brand, hasUnsavedChanges, availableDocuments, selectedDocumentKey };
  }

  /* ------------------------------------------------------ cambios de contenido */
  module(id: string): AplusModule | undefined {
    return this.store.getState().modules.find(module => module.id === id);
  }

  private patchModule(id: string, change: (module: AplusModule) => AplusModule): void {
    this.store.setState(state => ({ modules: state.modules.map(module => (module.id === id ? change(module) : module)) }));
  }

  /** E07: «Cambios sin guardar» al editar, añadir o eliminar; la caché guarda cada edición. */
  private markChanged(): void {
    this.edits += 1;
    this.store.setState({ hasUnsavedChanges: true });
    this.cache.schedule();
  }

  setContent(id: string, content: ModuleContent): void {
    if (!this.module(id)) return;
    this.patchModule(id, module => ({ ...module, content }) as AplusModule);
    this.markChanged();
  }

  setField(id: string, field: FieldPath, index: number, value: string): void {
    const module = this.module(id);
    if (module) this.setContent(id, applyField(module.content, field, index, value));
  }

  /** handleRichTextChange: solo si el texto plano cambia. */
  setBodyText(id: string, text: string): void {
    const module = this.module(id);
    if (module?.type !== 'text-overlay' || text === str(module.content.bodyText)) return;
    this.setContent(id, { ...module.content, bodyText: text });
  }

  /** handleModuleValidationChange: valida con el contenido vigente (E14/E43/E50). */
  validate(id: string): void {
    const module = this.module(id);
    const errors = module ? validateModule(module) : null;
    if (!errors) return;
    this.patchModule(id, current => ({ ...current, isValid: errors.length === 0, validationErrors: errors }));
  }

  addModule(type: EditableModuleType): string {
    let id = `module-${Date.now()}`;
    while (this.module(id)) id = `${id}-1`;
    this.store.setState(state => ({ modules: [...state.modules, createModule(type, id)] }));
    toast.success('Módulo añadido correctamente');
    this.markChanged();
    return id;
  }

  /** Elimina el módulo y devuelve el que queda en su lugar (para llevar el foco). */
  deleteModule(id: string): string | null {
    const modules = this.store.getState().modules;
    const index = modules.findIndex(module => module.id === id);
    if (index < 0) return null;
    const next = modules.filter(module => module.id !== id);
    this.store.setState({ modules: next });
    toast.success('Módulo eliminado');
    this.markChanged();
    return next[Math.min(index, next.length - 1)]?.id ?? null;
  }

  removeImage(id: string, index: number | null): void {
    const module = this.module(id);
    if (!module) return;
    const content = withModuleImage(module, index, null);
    if (!content) return;
    releaseBlob(getModuleImage(module, index));
    this.setContent(id, content);
    toast.success(module.type === 'four-images' ? `Imagen ${(index ?? 0) + 1} eliminada` : 'Imagen eliminada');
  }

  private changeSpecs(id: string, change: (content: SpecsContent) => SpecsContent | null): void {
    const module = this.module(id);
    if (module?.type !== 'specifications') return;
    const content = change(module.content);
    if (content) this.setContent(id, content);
  }

  addBlock(id: string): void { this.changeSpecs(id, addBlock); }
  removeBlock(id: string, index: number): void { this.changeSpecs(id, content => removeBlock(content, index)); }
  addBullet(id: string): void { this.changeSpecs(id, addBullet); }
  removeBullet(id: string, index: number): void { this.changeSpecs(id, content => removeBullet(content, index)); }

  /* --------------------------------------------------------------- imágenes */
  /** handleFileSelect de los tres editores; true si la imagen quedó colocada. */
  async uploadImage(id: string, index: number | null, file: File): Promise<boolean> {
    const module = this.module(id);
    const target = module ? uploadTarget(module, index) : null;
    if (!target) return false;
    const token = this.session;
    let image;
    try {
      image = await handleImageUploadWithToast(file, target.minW, target.minH, target.altText);
    } catch {
      return false; // el aviso de error ya se mostró
    }
    const current = this.live(token) ? this.module(id) : undefined;
    if (!current) return false;
    const content = withModuleImage(current, index, image);
    if (!content) return false;
    releaseBlob(getModuleImage(current, index));
    this.setContent(id, content);
    return true;
  }

  /** Datos del producto para Uony (producto con ediciones, Atributos e Imágenes). */
  ecosystem(id: string): EcosystemData {
    const module = this.module(id);
    const { scope } = this.options;
    const sources = readEcosystemSources(this.options.source().draft(), scope.get('customFields', undefined), scope.get('images', undefined));
    return getProductEcosystemData(module?.type === 'text-overlay' ? str(module.content.headline) : '', sources);
  }

  /** «Sugerir desde galería del producto». */
  suggestImage(id: string): void {
    const module = this.module(id);
    if (module?.type !== 'text-overlay') return;
    const image = buildSuggestedImage(this.ecosystem(id), TO.minW, TO.minH);
    if (!image) {
      toast.error('No hay imágenes disponibles en la galería del producto');
      return;
    }
    this.setContent(id, { ...module.content, backgroundImage: image });
    toast.success('Imagen sugerida desde la galería del producto aplicada');
  }

  /**
   * Generador de contenido (handleAIContentGeneration): Uony escribe titular y
   * cuerpo con los datos del producto. `onApplied` se llama antes del aviso (cierra
   * el diálogo). Devuelve si se aplicó.
   */
  async generate(id: string, onApplied?: () => void): Promise<boolean> {
    const token = this.session;
    try {
      if (!this.module(id)) throw new Error('Módulo no encontrado');
      const data = this.ecosystem(id);
      const response = await aplusApi.generateAplusContent({
        module_type: 'text-overlay',
        product: toGenerateProductInfo(data),
        limits: { headline: TO.headline, body: TO.body },
      });
      if (!this.live(token)) return false;
      const current = this.module(id);
      if (current?.type !== 'text-overlay') throw new Error('Módulo no encontrado');
      const headline = str(response?.headline).slice(0, TO.headline);
      const bodyText = str(response?.bodyText).slice(0, TO.body);
      this.setContent(id, { ...current.content, headline, bodyText });
      onApplied?.();
      toast.success('Contenido generado por Uony con los datos del producto');
      return true;
    } catch {
      if (this.live(token)) toast.error('Error al generar contenido con Uony');
      return false;
    }
  }

  /* ------------------------------------------------------ Amazon y guardado */
  reload(): void {
    reloadAplus(this);
  }

  selectDocument(contentReferenceKey: string): void {
    const state = this.store.getState();
    if (state.loading || state.publishing) return;
    const previous = state.selectedDocumentKey;
    if (contentReferenceKey === previous) return;
    void loadDocumentContent(this, contentReferenceKey, previous);
  }

  save(operation: SaveOperation): Promise<void> {
    return saveAplus(this, operation);
  }
}
