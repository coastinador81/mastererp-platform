import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { pimStore } from '@/shared/pim';
import { sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import { GuideCard } from './GuideCard';
import { handleGuideText } from './actions';
import { cacheGuideProduct } from './draft';
import { guideOf, newGuide, patchGuide, resetGuides } from './store';

beforeEach(() => {
  resetGuides(); queryClient.clear(); pimStore.clear();
  cacheGuideProduct(sampleProduct());
  Object.entries(sampleSlices()).forEach(([key, value]) => pimStore.set('UON-KIT-01', key, value));
  newGuide('preview-flow'); patchGuide('preview-flow', { step: 'ready', sku: 'UON-KIT-01' });
});
afterEach(() => vi.restoreAllMocks());

function journey() {
  const openProduct = vi.fn();
  const requestChanges = vi.fn(() => screen.getByRole('textbox', { name: 'Mensaje a Uony' }).focus());
  render(<QueryClientProvider client={queryClient}>
    <GuideCard threadId="preview-flow" send={text => { void handleGuideText('preview-flow', text); }} openProduct={openProduct} requestChanges={requestChanges} pause={vi.fn()} />
    <textarea aria-label="Mensaje a Uony" defaultValue="Conserva mi borrador" />
  </QueryClientProvider>);
  expect(screen.queryByRole('heading', { name: 'Contenido A+' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  return { openProduct, requestChanges, dialog: () => within(screen.getByRole('dialog', { name: 'Tu ficha para Amazon.es' })) };
}

describe('Revisión integrada en el recorrido con Uony', () => {
  it('vuelve al chat para pedir cambios sin publicar ni perder el texto escrito', () => {
    const post = vi.spyOn(api, 'post');
    const { dialog, requestChanges } = journey();
    expect(dialog().getByRole('img', { name: 'Uonify' })).toBeInTheDocument();
    expect(dialog().getByRole('heading', { name: 'Contenido A+' })).toBeInTheDocument();
    fireEvent.click(dialog().getByRole('button', { name: 'Pedir cambios con Uony' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestChanges).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('textbox')).toHaveValue('Conserva mi borrador');
    expect(post).not.toHaveBeenCalled();
  });
  it('cierra la vista completa sin insertarla en la conversación y permite reabrirla', () => {
    const { dialog } = journey();
    fireEvent.click(dialog().getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contenido A+' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
    expect(dialog().getByRole('heading', { name: 'Contenido A+' })).toBeInTheDocument();
  });
  it('abre el mismo SKU en Producto desde la vista ampliada', () => {
    const { dialog, openProduct } = journey();
    fireEvent.click(dialog().getByRole('button', { name: 'Abrir en Producto' }));
    expect(openProduct).toHaveBeenCalledWith('UON-KIT-01');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('exige revisar de nuevo los cambios manuales y publica el borrador actualizado una sola vez', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ product: { ...sampleProduct(), price: '29.90', status: 'published' }, status: 'published', publicationUrl: 'https://www.amazon.es/dp/B0TEST0001' });
    const { dialog } = journey();
    act(() => { pimStore.set('UON-KIT-01', 'edited', { price: '29.90' }); });
    expect(dialog().queryByRole('button', { name: 'Aprobar y publicar' })).not.toBeInTheDocument();
    fireEvent.click(dialog().getByRole('button', { name: 'Revisar versión actual' }));
    expect(post).not.toHaveBeenCalled();
    expect(dialog().getAllByLabelText('29,90 €')).toHaveLength(2);
    fireEvent.click(dialog().getByRole('button', { name: 'Aprobar y publicar' }));
    await waitFor(() => expect(guideOf('preview-flow').step).toBe('published'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/product-guides/publish', expect.objectContaining({ product: expect.objectContaining({ sku: 'UON-KIT-01', price: '29.90' }) }));
    expect(screen.getByRole('link', { name: 'Ver producto en Amazon' })).toHaveAttribute('href', 'https://www.amazon.es/dp/B0TEST0001');
    expect(screen.queryByRole('button', { name: 'Ver vista previa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar y publicar' })).not.toBeInTheDocument();
  });
});
