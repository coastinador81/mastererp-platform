import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pimStore } from '@/shared/pim';
import { dialog, toast } from '@/shared/ui';
import { handlers } from '@/shared/mocks/handlers';
import { resetBalance } from '../jobs/balance';
import { resetJobs } from '../jobs/jobsStore';
import { stopAllPolling } from '../jobs/polling';
import { readStudio } from '../model/studio';
import { PRODUCT, SAMPLE_STUDIO, SAMPLE_VIDEO_ITEM, SKU, makeContext, renderTab, seed } from './harness';

const server = setupServer(...handlers);
const nbsp = (text: string | null) => String(text).replace(/[\u00a0\u202f]/g, ' ');

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  pimStore.clear();
  sessionStorage.clear();
  localStorage.clear();
  resetBalance();
  resetJobs();
});
afterEach(() => {
  stopAllPolling();
  act(() => {
    dialog.close();
    toast.dismiss();
  });
  server.resetHandlers();
});
afterAll(() => server.close());

describe('pestaña Vídeo · estudio «Crear con Uony»', () => {
  it('sin vídeos abre el estudio con el borrador de la ficha y el saldo', async () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 2, name: 'Vídeo' })).toBeInTheDocument();
    expect(screen.getByText('0 vídeos')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Crear con Uony' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Crear con Uony');
    expect(screen.getByText('4 planos · 0:30')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'Texto en pantalla' }).map(input => (input as HTMLInputElement).value)).toEqual(['25 piezas de madera', 'Apila por turnos', '', '']);
    expect(screen.getByRole('textbox', { name: 'Lema del cierre' })).toHaveValue('Uonify');
    expect(screen.getByRole('radio', { name: /Ficha de Amazon/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(nbsp(screen.getByText(/Saldo disponible/).textContent)).toBe('Saldo disponible: 60,00 €'));
    // El borrador no se guarda hasta que se edita.
    expect(pimStore.get(SKU, 'videoStudio', null)).toBeNull();
  });

  it('el anuncio solo admite 16:9 y tiene dos planos', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('radio', { name: /Anuncio/ }));
    expect(screen.getByText('2 planos · 0:15')).toBeInTheDocument();
    const vertical = screen.getByRole('radio', { name: /Vertical 9:16/ });
    expect(vertical).toHaveAttribute('aria-disabled', 'true');
    expect(vertical).toHaveAccessibleDescription('El anuncio solo admite 16:9');
    expect(readStudio(pimStore.get(SKU, 'videoStudio', null)).destination).toBe('ads');
  });

  it('sin fotos no genera: avisa y lleva al plano que falta', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Generar vídeo' }));
    expect(await screen.findByText('Revisa el guion antes de generar')).toBeInTheDocument();
    expect(screen.getAllByText('Elige una foto para este plano.').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir la foto del plano 1' })).toHaveFocus());
  });

  it('«Proponer con Uony» sustituye el guion con la propuesta del servidor', async () => {
    seed({ images: [{ id: 'main', url: 'https://cdn.uonify.com/main.jpg', name: 'main.jpg', dimensions: { width: 1600, height: 1600 } }] });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Proponer con Uony' }));
    expect(await screen.findByText('Propuesto por Uony', {}, { timeout: 4000 })).toBeInTheDocument();
    const plan = readStudio(pimStore.get(SKU, 'videoStudio', null)).plans.listing;
    expect(plan?.origin).toBe('ia');
    expect(plan?.shots[0].image?.id).toBe('main');
  });

  it('la primera vez pide las condiciones y después genera el vídeo', async () => {
    seed({ videoStudio: SAMPLE_STUDIO });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Generar vídeo' }));
    const terms = await screen.findByRole('dialog', { name: 'Condiciones de los modelos de IA' });
    const accept = within(terms).getByRole('button', { name: 'Aceptar y generar' });
    expect(accept).toBeDisabled();
    await userEvent.click(within(terms).getByRole('checkbox', { name: 'He leído y acepto estas condiciones.' }));
    expect(accept).toBeEnabled();
    await userEvent.click(accept);
    expect(await screen.findByRole('heading', { name: 'En cola' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('0/4 planos')).toBeInTheDocument();
    // Cada plano muestra su estado.
    expect(screen.getAllByText('En cola', { selector: '.pim-badge' })).toHaveLength(4);
    expect(screen.getByRole('group', { name: 'Configuración del vídeo' })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem('uonify-ai-terms') || 'null')).toMatchObject({ version: '2026-09-26' });
    const project = readStudio(pimStore.get(SKU, 'videoStudio', null)).project;
    expect(project?.status).toBe('queued');
    expect(screen.getByRole('button', { name: 'Generar vídeo' })).toHaveAttribute('data-tooltip', 'Espera a que termine el vídeo en curso');
  });

  it('un producto sin guardar no genera', async () => {
    seed({ videoStudio: SAMPLE_STUDIO }, '__new__');
    renderTab(makeContext(null));
    await userEvent.click(screen.getByRole('button', { name: 'Generar vídeo' }));
    expect(await screen.findByText('Guarda el producto antes de generar su vídeo.')).toBeInTheDocument();
  });
});

describe('pestaña Vídeo · biblioteca', () => {
  it('muestra el vídeo, sus escenas y los requisitos de la ficha de Amazon', () => {
    seed({ video: { videos: [SAMPLE_VIDEO_ITEM], selectedId: SAMPLE_VIDEO_ITEM.id } });
    renderTab();
    expect(screen.getByText('1 vídeo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vídeos del producto' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 3, name: SAMPLE_VIDEO_ITEM.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Juntos, pieza a pieza., 0:06' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requisitos de la ficha de Amazon' })).toBeInTheDocument();
    expect(screen.getByText('Listo para subir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir a Seller Central' })).toHaveClass('pim-btn-primary');
  });

  it('«Subir a Seller Central» es una guía con descarga, enlace y datos para copiar', async () => {
    seed({ video: { videos: [SAMPLE_VIDEO_ITEM], selectedId: SAMPLE_VIDEO_ITEM.id } });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Subir a Seller Central' }));
    const guide = await screen.findByRole('dialog', { name: 'Subir a Seller Central' });
    expect(within(guide).getByRole('link', { name: /Abrir Seller Central/ })).toHaveAttribute('href', 'https://sellercentral.amazon.es/creatorhub/video/library/');
    expect(within(guide).getByText(PRODUCT.asin as string)).toBeInTheDocument();
    expect(within(guide).getByRole('button', { name: 'Copiar título' })).toBeInTheDocument();
  });

  it('sin ASIN, avisa de lo que falta y lleva a los requisitos', async () => {
    seed({ video: { videos: [SAMPLE_VIDEO_ITEM], selectedId: SAMPLE_VIDEO_ITEM.id } });
    renderTab(makeContext({ ...PRODUCT, asin: '' }));
    expect(screen.getByText('1 por revisar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Subir a Seller Central' }));
    expect(await screen.findByText('Revisa: ASIN.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requisitos de la ficha de Amazon' })).toHaveFocus();
  });

  it('como anuncio: requisitos de Amazon Ads y «Descargar para Amazon Ads» (decisión del dueño)', async () => {
    seed({ video: { videos: [SAMPLE_VIDEO_ITEM], selectedId: SAMPLE_VIDEO_ITEM.id } });
    renderTab();
    await userEvent.click(screen.getByRole('radio', { name: /Anuncio/ }));
    expect(screen.getByRole('heading', { name: 'Requisitos de Amazon Ads' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar para Amazon Ads' })).toHaveClass('pim-btn-primary');
    expect(screen.queryByRole('button', { name: 'Enviar a Amazon Ads' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Nombre del vídeo' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Idioma del vídeo' })).toBeNull();
  });

  it('eliminar un vídeo pide confirmación y vuelve al estado vacío', async () => {
    seed({ video: { videos: [SAMPLE_VIDEO_ITEM], selectedId: SAMPLE_VIDEO_ITEM.id } });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${SAMPLE_VIDEO_ITEM.name}` }));
    const confirm = await screen.findByRole('dialog', { name: '¿Eliminar este vídeo?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('Añade el vídeo de tu producto')).toBeInTheDocument();
    expect(screen.getByText('0 vídeos')).toBeInTheDocument();
  });
});
