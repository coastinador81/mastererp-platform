import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '@/shared/api/queryClient';
import { pimStore } from '@/shared/pim';
import { sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import { cacheGuideProduct } from './draft';
import { GuidePreview } from './GuidePreview';
import { previewPrice, productAttributes } from './amazonPreviewModel';

beforeEach(() => {
  queryClient.clear(); pimStore.clear();
  cacheGuideProduct(sampleProduct());
  Object.entries(sampleSlices()).forEach(([key, value]) => pimStore.set('UON-KIT-01', key, value));
});
function preview() {
  const view = render(<QueryClientProvider client={queryClient}><GuidePreview sku="UON-KIT-01" /></QueryClientProvider>);
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  return { ...view, container: view.baseElement };
}
describe('Vista previa con estructura Amazon', () => {
  it('muestra el mismo precio en la ficha y el bloque de compra y se actualiza con el módulo', () => {
    preview();
    expect(screen.getAllByLabelText('34,90 €')).toHaveLength(2);
    act(() => { pimStore.set('UON-KIT-01', 'edited', { price: '29.90' }); });
    expect(screen.getAllByLabelText('29,90 €')).toHaveLength(2);
    expect(screen.queryByLabelText('34,90 €')).not.toBeInTheDocument();
  });
  it('permite recorrer galería y vídeo, y los controles de compra no hacen pedidos', () => {
    const { container } = preview();
    fireEvent.click(screen.getByRole('button', { name: 'Ver imagen 2' }));
    expect(container.querySelector('.amazon-preview-hero')).toHaveAttribute('src', '/assets/jenga/ficha/UON-KIT-01.PT01.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Ver vídeo del producto' }));
    const movie = sampleSlices().video as { videos: { url: string; poster: string }[] };
    const player = container.querySelector('.amazon-preview-media video');
    expect(player).toHaveAttribute('src', movie.videos[0].url);
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('playsinline');
    expect(screen.getByRole('button', { name: 'Ver vídeo del producto' }).querySelector('img')).toHaveAttribute('src', movie.videos[0].poster);
    fireEvent.click(screen.getByRole('button', { name: 'Contenido siguiente' }));
    expect(container.querySelector('.amazon-preview-media video')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir a la cesta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Comprar ya' })).toBeDisabled();
    expect(screen.queryByText(/estrellas|calificaciones|entrega gratis/i)).not.toBeInTheDocument();
  });
  it('amplía imágenes y permite recorrerlas con teclado sin mantener el zoom de otra imagen', () => {
    const { container } = preview();
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }));
    expect(container.querySelector('.amazon-preview-stage')).toHaveAttribute('data-zoom', 'true');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ver imagen 1' }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Ver imagen 2' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Ver imagen 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.amazon-preview-stage')).toHaveAttribute('data-zoom', 'false');
  });
  it('presenta el A+ completo y enlaces que apuntan a cada sección del mismo visor', () => {
    const { container } = preview();
    expect(screen.getByRole('heading', { name: 'Contenido A+' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dentro de la caja' })).toBeInTheDocument();
    const source = sampleSlices().aplus as { content: { local: { data: { modules: unknown[] } } } };
    expect(container.querySelector('.amazon-preview-aplus-content')?.children).toHaveLength(source.content.local.data.modules.length);
    const sections = within(screen.getByRole('navigation', { name: 'Secciones de la ficha' }));
    sections.getAllByRole('link').forEach(link => {
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeInTheDocument();
    });
  });
  it('omite precios ausentes y muestra solo atributos propios del producto', () => {
    expect(previewPrice(undefined)).toBeNull();
    expect(previewPrice('')).toBeNull();
    expect(previewPrice('abc')).toBeNull();
    expect(previewPrice('29,90')?.label).toBe('29,90\u00a0€');
    expect(productAttributes({ name: 'Juego', sku: '1', customFields: [{ name: 'Requiere pilas', value: false }] })).toEqual([{ name: 'Requiere pilas', value: 'No' }]);
  });
});
