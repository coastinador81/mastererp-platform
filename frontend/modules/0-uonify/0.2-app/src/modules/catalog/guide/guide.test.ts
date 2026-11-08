import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { pimStore } from '@/shared/pim';
import { queryClient } from '@/shared/api/queryClient';
import { sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import { handleGuideText, pauseGuide } from './actions';
import { cacheGuideProduct, editGuideProduct, fingerprint, guideDraft } from './draft';
import { guideOf, newGuide, patchGuide, resetGuides } from './store';
import { editFromText, publicationApproved, startsGuide } from './model';

beforeEach(() => { resetGuides(); pimStore.clear(); queryClient.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function ready() {
  newGuide('a'); cacheGuideProduct(sampleProduct());
  patchGuide('a', { step: 'ready', sku: 'UON-KIT-01' });
}
describe('Recorrido Amazon con un borrador compartido', () => {
  it('requiere el recorrido y no interpreta una pregunta o negativa como aprobación', () => {
    expect(startsGuide('Quiero subir un producto a Amazon')).toBe(true);
    expect(startsGuide('Importar mi catálogo de Amazon')).toBe(false);
    for (const text of ['no lo publiques', '¿puedes publicarlo?', 'si digo aprobado, súbelo', 'sí', 'no aprobado, súbelo']) expect(publicationApproved(text)).toBe(false);
    expect(publicationApproved('Perfecto, aprobado, súbelo')).toBe(true);
  });
  it('conecta primero Amazon, después Drive, y exige confirmar los archivos', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ connected: true });
    await handleGuideText('a', 'Quiero subir un producto a Amazon');
    expect(guideOf('a').step).toBe('amazon');
    await handleGuideText('a', 'Conectar Google Drive');
    expect(post).not.toHaveBeenCalled();
    await handleGuideText('a', 'Conectar Amazon');
    await handleGuideText('a', 'Conectar Google Drive');
    expect(guideOf('a').step).toBe('folder');
    post.mockResolvedValueOnce({ folder: 'Uonify / Make It Possible', files: [] });
    await handleGuideText('a', 'En Uonify / Make It Possible');
    expect(guideOf('a').step).toBe('files');
    await handleGuideText('a', 'No prepares nada');
    expect(guideOf('a').step).toBe('files');
  });
  it('no publica sin vista previa y revoca la aprobación con cambios manuales', async () => {
    ready(); const post = vi.spyOn(api, 'post');
    await handleGuideText('a', 'aprobado, súbelo');
    expect(post).not.toHaveBeenCalled();
    await handleGuideText('a', 'Muéstrame la vista previa');
    pimStore.set('UON-KIT-01', 'edited', { price: '29.90' });
    await handleGuideText('a', 'aprobado, súbelo');
    expect(post).not.toHaveBeenCalled();
    expect(guideOf('a').reviewed).toBeUndefined();
  });
  it('prepara las mismas porciones del módulo, sin pisar ediciones manuales', async () => {
    vi.useFakeTimers(); newGuide('a'); patchGuide('a', { step: 'files' });
    pimStore.set('UON-KIT-01', 'images', [{ id: 'manual', url: '/manual.jpg' }]);
    vi.spyOn(api, 'post').mockResolvedValue({ product: sampleProduct(), sample: { id: 'UON-KIT-01', version: 3, slices: sampleSlices() } });
    const promise = handleGuideText('a', 'Prepara la ficha');
    await vi.runAllTimersAsync(); await promise;
    expect(guideOf('a').step).toBe('ready');
    expect(pimStore.get('UON-KIT-01', 'images')).toEqual([{ id: 'manual', url: '/manual.jpg' }]);
    expect(pimStore.get('UON-KIT-01', 'video')).toBeDefined();
    expect(pimStore.get('UON-KIT-01', 'aplus')).toBeDefined();
  });
  it('no escribe en el PIM si se pausa o cambia la cuenta durante la petición', async () => {
    newGuide('a'); patchGuide('a', { step: 'files' });
    let finish!: (value: unknown) => void;
    vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = handleGuideText('a', 'Prepara la ficha');
    pauseGuide('a');
    finish({ product: sampleProduct(), sample: { id: 'UON-KIT-01', version: 3, slices: sampleSlices() } });
    await pending;
    expect(pimStore.entry('UON-KIT-01')).toBeUndefined();
    expect(guideOf('a').paused).toBe(true);
  });
  it('edita por conversación el mismo borrador que muestra el módulo', async () => {
    ready(); await handleGuideText('a', 'cambia el precio a 29,90 euros');
    expect(guideDraft()?.price).toBe('29.90');
    expect(pimStore.get('UON-KIT-01', 'edited')).toEqual({ price: '29.90' });
    expect(editFromText('cambia el título a Juego de madera Uonify')).toEqual({ name: 'Juego de madera Uonify' });
    expect(editFromText('cambia el precio a -8')).toBeNull();
  });
  it('publica una vez la versión revisada y conserva ediciones posteriores al envío', async () => {
    ready(); await handleGuideText('a', 'Muéstrame la vista previa');
    let finish!: (value: unknown) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = handleGuideText('a', 'aprobado, súbelo');
    await handleGuideText('a', 'aprobado, súbelo');
    expect(post).toHaveBeenCalledTimes(1);
    editGuideProduct({ price: '22.00' });
    finish({ product: { ...sampleProduct(), status: 'published' }, status: 'published' });
    await pending;
    expect(guideOf('a').step).toBe('ready');
    expect(guideDraft()?.price).toBe('22.00');
    expect(guideOf('a').reviewed).toBeUndefined();
  });
  it('entrega el enlace confirmado y repetir la aprobación no vuelve a publicar', async () => {
    ready(); await handleGuideText('a', 'Muéstrame la vista previa');
    const publicationUrl = 'https://www.amazon.es/dp/B0TEST0001';
    const post = vi.spyOn(api, 'post').mockResolvedValue({ product: sampleProduct(), status: 'published', publicationUrl });
    const reply = await handleGuideText('a', 'Aprobar y publicar');
    expect(reply.text).toBe('Tu producto ya está publicado en Amazon. Aquí tienes el enlace para verlo.');
    expect(guideOf('a')).toMatchObject({ step: 'published', publicationUrl, busy: false });
    await handleGuideText('a', 'Aprobar y publicar');
    expect(post).toHaveBeenCalledOnce();
    expect(guideOf('a').publicationUrl).toBe(publicationUrl);
  });
  it('no entrega un enlace ni confirma visibilidad mientras Amazon procesa el envío', async () => {
    ready(); await handleGuideText('a', 'Muéstrame la vista previa');
    vi.spyOn(api, 'post').mockResolvedValue({ status: 'processing', publicationUrl: 'https://www.amazon.es/dp/B0TEST0001' });
    const reply = await handleGuideText('a', 'Aprobar y publicar');
    expect(reply.text).toContain('Todavía no tengo confirmación');
    expect(guideOf('a').publicationUrl).toBeUndefined();
    expect(guideOf('a').published).toBeUndefined();
  });
  it('sin enlace confirmado no inventa una dirección ni afirma una publicación real', async () => {
    ready(); await handleGuideText('a', 'Muéstrame la vista previa');
    vi.spyOn(api, 'post').mockResolvedValue({ product: sampleProduct(), status: 'published' });
    const reply = await handleGuideText('a', 'Aprobar y publicar');
    expect(reply.text).toContain('Todavía no tengo un enlace confirmado');
    expect(guideOf('a').publicationUrl).toBeUndefined();
  });
  it('un fallo de publicación conserva el borrador y deja reintentar', async () => {
    ready(); await handleGuideText('a', 'Muéstrame la vista previa');
    const before = fingerprint(); vi.spyOn(api, 'post').mockRejectedValue(new Error('Sin conexión'));
    const reply = await handleGuideText('a', 'Aprobar y publicar');
    expect(reply.text).toContain('volver a intentarlo');
    expect(fingerprint()).toBe(before);
    expect(guideOf('a').busy).toBe(false);
    expect(guideOf('a').step).toBe('preview');
  });
});
