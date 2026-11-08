import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { pimStore } from '@/shared/pim';
import { tab } from '../index';
import { renderTab, resetAll, SKU, upload } from './renderTab';

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../__tests__/**'], { query: '?raw', import: 'default', eager: true });

beforeEach(resetAll);

describe('pestaña «Imágenes»: estructura (pruebas del prototipo)', () => {
  it('se registra como la pestaña «imagenes»', () => {
    expect(tab).toMatchObject({ key: 'imagenes', label: 'Imágenes', icon: null });
  });

  it('sin «Editor IA» ni «Generador IA» (retirados por el dueño)', () => {
    const code = Object.values(sources).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(code).not.toMatch(/Quitar Fondo|Crear Escena|data-region="editor"/);
    expect(code).not.toMatch(/Generador IA|Configurar estilo|Configuración Activa|Configuración de Estilo IA|data-region="generator"/);
    renderTab();
    expect(screen.queryByText(/Quitar Fondo|Crear Escena|Pulir|Estilizar|Generador IA|Configurar estilo/)).toBeNull();
  });

  it('«Generar Imágenes» está bajo «Extraer Imágenes desde URL»', () => {
    renderTab();
    const scraper = screen.getByRole('region', { name: 'Extraer Imágenes desde URL' });
    const input = within(scraper).getByLabelText('URL del Producto');
    const generate = within(scraper).getByRole('button', { name: 'Generar Imágenes' });
    expect(generate).toHaveClass('pim-btn-ai');
    expect(input.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(scraper).getByRole('button', { name: 'Extraer Imágenes desde URL' })).toBeDisabled();
  });

  it('cabecera «Media», subida y extracción lado a lado, sin galería si no hay imágenes', () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 2, name: 'Media' })).toBeInTheDocument();
    expect(screen.getByText('0 imágenes')).toHaveClass('pim-badge', 'pim-imagenes-total');
    expect(screen.getByRole('region', { name: 'Subir Imágenes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seleccionar')).toHaveAttribute('accept', 'image/jpeg,image/jpg,image/png,image/webp');
    expect(screen.getByText('JPG, PNG, WEBP • Máx. 10MB')).toBeInTheDocument();
    expect(screen.queryByText(/Galería de Imágenes/)).toBeNull();
  });
});

describe('galería', () => {
  it('pinta subidas, procesadas e IA con sus insignias y recuentos', () => {
    pimStore.set(SKU, 'images', [upload('u1', 'UON-KIT-01.MAIN.jpg'), upload('u2', 'UON-KIT-01.PT01.jpg')]);
    pimStore.set(SKU, 'processedImages', [upload('p1', 'Processed UON-KIT-01.PT01.jpg', { status: 'processed', dimensions: { width: 1500, height: 1500 } })]);
    pimStore.set(SKU, 'aiImages', [upload('a1', 'lifestyle-la-partida.jpg', { source: 'ai-generated', status: 'generated', style: 'lifestyle' })]);
    renderTab();
    expect(screen.getByText('3 imágenes')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Galería de Imágenes (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Imágenes Procesadas (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Imágenes IA Generadas (1)' })).toBeInTheDocument();
    // Las procesadas llevan también la insignia de su origen.
    expect(screen.getAllByText('Subida')).toHaveLength(3);
    expect(screen.getByText('1500 × 1500px')).toBeInTheDocument();
    expect(screen.getAllByText('2KB')).toHaveLength(2);
    expect(screen.getAllByText('2000 × 2000px')).toHaveLength(2);
    expect(screen.getByText('Procesada')).toHaveClass('pim-badge-green');
    expect(screen.getByText('lifestyle')).toHaveClass('pim-badge');
    expect(screen.getByText('IA')).toHaveClass('pim-badge-ai');
    expect(screen.getByRole('button', { name: 'Favorito' })).toHaveAttribute('data-tooltip', 'Favorito');
    // La porción 'images' queda con la galería completa (la leen 3D, A+ y el guardado).
    expect(pimStore.get<Array<{ id: string }>>(SKU, 'images').map(i => i.id)).toEqual(['u1', 'u2', 'a1', 'p1']);
  });

  it('«Todas», «Eliminar» y el foco vuelve a «Generar Imágenes» al quedarse vacía', async () => {
    const user = userEvent.setup();
    pimStore.set(SKU, 'images', [upload('u1', 'a.jpg'), upload('u2', 'b.jpg')]);
    renderTab();
    const eliminar = screen.getByRole('button', { name: 'Eliminar' });
    expect(eliminar).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redimensionar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByRole('checkbox', { name: 'Seleccionar a.jpg' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar b.jpg' })).toBeChecked();
    await user.click(eliminar);
    expect(await screen.findByText('🗑️ 2 imágenes eliminadas')).toBeInTheDocument();
    expect(screen.queryByText(/Galería de Imágenes/)).toBeNull();
    expect(screen.getByText('0 imágenes')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Generar Imágenes' }));
    expect(pimStore.get(SKU, 'deletedImageUrls')).toEqual(['/assets/jenga/ficha/a.jpg', '/assets/jenga/ficha/b.jpg']);
  });

  it('marcar una casilla habilita «Eliminar» y quita solo esa', async () => {
    const user = userEvent.setup();
    pimStore.set(SKU, 'images', [upload('u1', 'a.jpg'), upload('u2', 'b.jpg')]);
    renderTab();
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar b.jpg' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('🗑️ 1 imagen eliminada')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Galería de Imágenes (1)' })).toBeInTheDocument();
    expect(screen.queryByText('b.jpg')).toBeNull();
  });

  it('«Vaciar» quita las procesadas (y la galería sigue con solo procesadas o IA)', async () => {
    const user = userEvent.setup();
    pimStore.set(SKU, 'processedImages', [upload('p1', 'Processed a.jpg', { status: 'processed' })]);
    renderTab();
    expect(screen.getByRole('heading', { name: 'Galería de Imágenes (0)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vaciar' }));
    expect(await screen.findByText('🗑️ Imágenes procesadas eliminadas')).toBeInTheDocument();
    expect(screen.queryByText(/Imágenes Procesadas/)).toBeNull();
  });

  it('ADD-02: las imágenes del producto y las de Auditoría IA se ven como «Amazon» y «Scrapeada»', () => {
    pimStore.set(SKU, 'images', ['https://cdn.uonify.test/main.jpg', { url: 'https://tienda.test/x.jpg', file: null, source: 'scraped' }]);
    renderTab(SKU, { sku: SKU, name: 'Make It Possible by Uonify', images: ['https://cdn.uonify.test/main.jpg'] });
    expect(screen.getByText('Product Image 1')).toBeInTheDocument();
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByText('scraped-1.jpg')).toBeInTheDocument();
    expect(screen.getByText('Scrapeada')).toBeInTheDocument();
  });
});

describe('subida', () => {
  it('acepta JPG, PNG o WEBP y descarta el resto sin aviso', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderTab();
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'foto.png', { type: 'image/png' });
    const gif = new File(['GIF89a'], 'anim.gif', { type: 'image/gif' });
    await user.upload(screen.getByLabelText('Seleccionar'), [png, gif]);
    expect(await screen.findByText('✅ 1 imagen(es) subida(s) correctamente')).toBeInTheDocument();
    expect(screen.getByText('foto.png')).toBeInTheDocument();
    expect(screen.queryByText('anim.gif')).toBeNull();
    expect(screen.getByText('Subida')).toBeInTheDocument();
    const saved = pimStore.get<Array<{ url: string; source: string }>>(SKU, 'images');
    expect(saved[0]).toMatchObject({ source: 'upload' });
    expect(saved[0].url).toMatch(/^data:image\/png;base64,/);
  });

  it('también al soltar archivos en la zona', async () => {
    renderTab();
    const zone = screen.getByText('Arrastra imágenes aquí').closest('.pim-imagenes-drop') as HTMLElement;
    fireEvent.dragEnter(zone);
    expect(zone).toHaveClass('is-over');
    const file = new File(['x'], 'suelta.webp', { type: 'image/webp' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(zone).not.toHaveClass('is-over');
    expect(await screen.findByText('suelta.webp')).toBeInTheDocument();
  });
});

describe('vista previa', () => {
  it('navega con flechas y teclado, enseña los detalles y devuelve el foco al cerrar', async () => {
    const user = userEvent.setup();
    pimStore.set(SKU, 'images', [upload('u1', 'a.jpg', { size: 351930 }), upload('u2', 'b.jpg')]);
    renderTab();
    const eye = screen.getByRole('button', { name: 'Vista Previa de Imagen: a.jpg' });
    await user.click(eye);
    const dialog = screen.getByRole('dialog', { name: 'Vista Previa de Imagen' });
    expect(dialog).toHaveClass('pim-imagenes-preview-dialog', 'pim-dialog-xl');
    expect(within(dialog).getByText('Imagen 1 de 2')).toBeInTheDocument();
    expect(within(dialog).getByText('0.34 MB')).toBeInTheDocument();
    expect(within(dialog).getByText('2000 x 2000px')).toBeInTheDocument();
    expect(within(dialog).getByText('Upload')).toBeInTheDocument();
    expect(within(dialog).getByText('Listo')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'a.jpg' })).toHaveClass('pim-imagenes-stage-img');
    act(() => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
    expect(within(dialog).getByText('Imagen 2 de 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'b.jpg' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente imagen' }));
    expect(within(dialog).getByText('Imagen 1 de 2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Imagen anterior' }));
    expect(within(dialog).getByText('Imagen 2 de 2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar vista previa' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(eye);
  });
});
