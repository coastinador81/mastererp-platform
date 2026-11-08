import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPimStore } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { aplusApi } from '../api/aplusApi';
import { AplusController } from '../hooks/aplusController';
import { CACHE_TTL } from '../model/constants';
import { createModule } from '../model/content';
import { hexToBase64, md5Hex } from '../model/md5';
import type { AplusCacheData, AplusSlice } from '../model/types';
import { setupAplusServer } from './mockServer';

setupAplusServer();

const product = { sku: 'UON-KIT-01', name: 'Make It Possible by Uonify', brand: 'Uonify', category: 'Juguetes', description: '' };

function setup(asin?: string, slice?: AplusSlice) {
  const scope = createPimStore({ storage: null }).scope('UON-KIT-01');
  if (slice) scope.set('aplus', slice);
  const controller = new AplusController({ asin, scope, source: () => ({ product: { ...product, asin }, draft: () => ({ ...product, asin }) }) });
  return { controller, scope, state: () => controller.store.getState() };
}

const idle = (state: () => { loading: boolean; publishing: boolean }) =>
  waitFor(() => expect(state().loading || state().publishing).toBe(false));

afterEach(() => vi.restoreAllMocks());

describe('carga desde Amazon (cuenta simulada)', () => {
  it('un ASIN trae su contenido publicado con las imágenes descargadas', async () => {
    const success = vi.spyOn(toast, 'success');
    const { controller, state } = setup('B0TESTLOAD1');
    controller.start();
    await waitFor(() => expect(state().modules).toHaveLength(3));
    await idle(state);
    expect(state()).toMatchObject({ brand: 'Uonify', hasUnsavedChanges: false, availableDocuments: [expect.objectContaining({ contentMetadata: expect.objectContaining({ status: 'APPROVED' }) })] });
    expect(state().selectedDocumentKey).toBeTruthy();
    const overlay = state().modules[0];
    expect(overlay.type === 'text-overlay' && overlay.content.backgroundImage?.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(success).toHaveBeenCalledWith('✅ Contenido A+ PUBLICADO cargado: 3 módulos', expect.objectContaining({ description: expect.stringContaining('6 imágenes descargadas') }));
    controller.stop();
  });

  it('guardar un borrador actualiza el documento cargado y deja de haber cambios sin guardar', async () => {
    const { controller, state } = setup('B0TESTSAVE1');
    controller.start();
    await waitFor(() => expect(state().modules).toHaveLength(3));
    await idle(state);
    const key = state().selectedDocumentKey;
    controller.setField(state().modules[0].id, 'headline', 0, 'Make It Possible: juega en compañía.');
    expect(state().hasUnsavedChanges).toBe(true);
    await controller.save('draft');
    expect(state()).toMatchObject({ hasUnsavedChanges: false, selectedDocumentKey: key, publishing: false });
    const search = await aplusApi.searchAplusDocuments({ asin: 'B0TESTSAVE1', marketplace_id: 'A1RKKUPIHCS9HS' });
    expect(search.contentMetadataRecords?.[0]).toMatchObject({ contentReferenceKey: key, contentMetadata: { status: 'DRAFT' } });
    controller.stop();
  });

  it('publicar sin imágenes subidas avisa de que no se ha enviado a revisión', async () => {
    const warning = vi.spyOn(toast, 'warning');
    const { controller, state } = setup('B0TESTPUB01');
    controller.start();
    await waitFor(() => expect(state().modules).toHaveLength(3));
    await idle(state);
    controller.store.setState({ availableDocuments: [], selectedDocumentKey: '', modules: [createModule('text-overlay', 'nuevo')] });
    await controller.save('publish');
    expect(warning).toHaveBeenCalledWith('Contenido guardado, pero no se ha enviado a revisión', expect.objectContaining({ description: expect.stringContaining('Faltan imágenes subidas a Amazon en 1 módulo') }));
    expect(state().selectedDocumentKey).toBeTruthy();
    controller.stop();
  });

  it('Recargar trae de nuevo el contenido y descarta los cambios', async () => {
    const { controller, state } = setup('B0TESTRELO1');
    controller.start();
    await waitFor(() => expect(state().modules).toHaveLength(3));
    await idle(state);
    controller.deleteModule(state().modules[0].id);
    expect(state()).toMatchObject({ hasUnsavedChanges: true });
    controller.reload();
    await waitFor(() => expect(state().modules).toHaveLength(3));
    await idle(state);
    expect(state().hasUnsavedChanges).toBe(false);
    controller.stop();
  });
});

describe('producto sin ASIN (creado en Uonify)', () => {
  const cached = (headline: string): AplusCacheData => ({
    modules: [{ ...createModule('text-overlay', 'm1'), content: { headline, bodyText: 'Cuerpo', backgroundImage: null } }] as AplusCacheData['modules'],
    brand: 'Uonify',
    hasUnsavedChanges: false,
    availableDocuments: [],
    selectedDocumentKey: '',
  });

  it('A+ conserva sus módulos (sin caducidad) y «Recargar» no los borra', () => {
    const info = vi.spyOn(toast, 'info');
    const old = Date.now() - CACHE_TTL * 5;
    const { controller, state } = setup(undefined, { content: { local: { data: cached('Todo empieza jugando.'), timestamp: old } }, crk: {} });
    controller.start();
    expect(state().modules).toHaveLength(1);
    controller.reload();
    expect(info).toHaveBeenCalledWith('Este producto aún no tiene ASIN: no hay contenido A+ de Amazon que recargar.');
    expect(state().modules).toHaveLength(1);
    controller.stop();
  });

  it('cada edición llega a la caché «local» y se vuelca al salir de la pestaña', () => {
    const { controller, scope, state } = setup(undefined, { content: { local: { data: cached('Uno'), timestamp: 1 } } });
    controller.start();
    controller.setField(state().modules[0].id, 'headline', 0, 'Dos');
    controller.stop();
    const slice = scope.get<AplusSlice>('aplus');
    const saved = slice.content?.local.data.modules[0];
    expect(saved?.type === 'text-overlay' && saved.content.headline).toBe('Dos');
    expect(slice.content?.local.data.hasUnsavedChanges).toBe(true);
  });

  it('guardar pide un ASIN', async () => {
    const error = vi.spyOn(toast, 'error');
    const { controller } = setup(undefined, { content: { local: { data: cached('Uno'), timestamp: 1 } } });
    controller.start();
    await controller.save('draft');
    expect(error).toHaveBeenCalledWith('Se requiere un ASIN');
    controller.stop();
  });

  it('Uony genera titular y cuerpo con los datos del producto', async () => {
    const { controller, state } = setup(undefined, { content: { local: { data: cached(''), timestamp: 1 } } });
    controller.start();
    const onApplied = vi.fn();
    const applied = await controller.generate('m1', onApplied);
    expect(applied).toBe(true);
    expect(onApplied).toHaveBeenCalled();
    const module = state().modules[0];
    if (module.type !== 'text-overlay') throw new Error('tipo');
    expect(module.content.headline).toContain('Make It Possible by Uonify');
    expect(module.content.headline.length).toBeLessThanOrEqual(70);
    expect(module.content.bodyText.length).toBeGreaterThan(0);
    expect(state().hasUnsavedChanges).toBe(true);
    controller.stop();
  });
});

describe('subida de imágenes (destino + S3 + image-proxy)', () => {
  it('la imagen subida con su MD5 se puede volver a descargar', async () => {
    const content = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
    const md5 = md5Hex(content);
    const destination = await aplusApi.getAplusUploadDestination({ contentType: 'image/jpeg', contentMD5: md5, marketplace_id: 'A1RKKUPIHCS9HS', country_code: 'ES' });
    expect(destination.uploadDestinationId).toMatch(/^aplus-media\/sc\/.+\.jpg$/);
    const fileContent = btoa(String.fromCharCode(...content));
    await expect(aplusApi.uploadImageToS3({ uploadUrl: destination.url as string, fileContent, contentType: 'image/jpeg', contentMD5: 'mal', headers: {} })).rejects.toMatchObject({
      status: 400,
      data: { error: 'La suma MD5 no coincide con el archivo' },
    });
    await aplusApi.uploadImageToS3({ uploadUrl: destination.url as string, fileContent, contentType: 'image/jpeg', contentMD5: hexToBase64(md5), headers: destination.headers ?? {} });
    const proxy = await aplusApi.getAplusImage({ uploadDestinationId: destination.uploadDestinationId as string });
    expect(proxy).toEqual({ image: fileContent, contentType: 'image/jpeg' });
  });

  it('una imagen que no existe responde IMAGE_NOT_ACCESSIBLE', async () => {
    await expect(aplusApi.getAplusImage({ uploadDestinationId: 'no-existe' })).rejects.toMatchObject({ status: 404, data: { error: 'IMAGE_NOT_ACCESSIBLE' } });
  });
});
