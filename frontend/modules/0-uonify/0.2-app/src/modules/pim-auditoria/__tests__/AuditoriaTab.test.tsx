import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pimStore } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { buildAuditResult } from '../mocks/fixtures/auditFixtures';
import { buildScrapedProduct } from '../mocks/fixtures/scrapeFixtures';
import type { AuditState, CustomField } from '../model/types';
import { makeContext, renderTab } from './renderTab';

vi.mock('../api/auditApi', async importOriginal => {
  const original = await importOriginal<typeof import('../api/auditApi')>();
  return { ...original, auditProduct: vi.fn(), scrapeProduct: vi.fn() };
});
import { auditProduct, scrapeProduct } from '../api/auditApi';

const URL_FRIDGE = 'https://tienda.es/frigorifico-combi-kelvia';
const solidButtons = () => document.querySelectorAll('.pim-auditoria .pim-btn-primary').length;

beforeEach(() => {
  pimStore.clear();
  vi.mocked(auditProduct).mockImplementation(async url => buildAuditResult(url));
  vi.mocked(scrapeProduct).mockImplementation(async input => buildScrapedProduct(input));
});
afterEach(() => {
  toast.dismiss();
});

async function auditFridge() {
  const user = userEvent.setup();
  const { context, edit, store } = makeContext();
  renderTab(context);
  await user.type(screen.getByLabelText('URL del Producto'), URL_FRIDGE);
  await user.click(screen.getByRole('button', { name: 'Auditar Producto' }));
  await screen.findByRole('heading', { name: /Atributos Amazon - Frigoríficos/ });
  await screen.findByText('Categorización Automática');
  return { user, context, edit, store };
}

describe('pestaña Auditoría IA', () => {
  it('estado vacío: cabecera, cuatro pasos y «Auditar Producto» deshabilitado sin URL', async () => {
    const user = userEvent.setup();
    renderTab(makeContext().context);
    expect(screen.getByRole('heading', { level: 2, name: 'Auditoría IA Inteligente' })).toBeInTheDocument();
    expect(screen.getByText(/Pega la URL del producto/)).toBeInTheDocument();
    const audit = screen.getByRole('button', { name: 'Auditar Producto' });
    expect(audit).toBeDisabled();
    expect(audit).toHaveClass('pim-btn-primary');
    await user.type(screen.getByLabelText('URL del Producto'), '   ');
    expect(audit).toBeDisabled();
  });

  it('auditar analiza y audita a la vez; la sugerencia lleva la única acción sólida', async () => {
    await auditFridge();
    expect(auditProduct).toHaveBeenCalledWith(URL_FRIDGE);
    expect(scrapeProduct).toHaveBeenCalledWith(URL_FRIDGE, 'TEST-1');
    expect(screen.queryByText(/Pega la URL del producto/)).not.toBeInTheDocument();
    expect(screen.getByText('REFRIGERATOR')).toBeInTheDocument();
    expect(screen.getByText('Frigorífico Combi', { selector: 'strong', exact: false })).toBeInTheDocument();
    expect(screen.getByText('Atributos Requeridos Faltantes (1)')).toBeInTheDocument();
    expect(screen.getByText('+2 más')).toBeInTheDocument();
    expect(await screen.findByText('✅ Auditoría completada: REFRIGERATOR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar categoría' })).toHaveClass('pim-btn-primary');
    expect(screen.getByRole('button', { name: /Auditar Producto/ })).toHaveClass('pim-btn-outline');
    expect(solidButtons()).toBe(1);
  });

  it('«Aplicar Atributos al Producto» escribe los atributos con valor en customFields (E17)', async () => {
    const { user, store } = await auditFridge();
    await user.type(screen.getByLabelText('Clase energética'), 'C');
    await user.click(screen.getByRole('button', { name: /Aplicar Atributos al Producto \(14 campos\)/ }));
    const fields = store.get<CustomField[]>('customFields', []);
    expect(fields.find(field => field.name === 'Calificación de Eficiencia Energética UE')?.value).toBe('C');
    expect(fields.find(field => field.name === 'Marca')?.value).toBe('Kelvia');
    expect(await screen.findByText('✅ 14 campos aplicados exitosamente! Revisa la pestaña Atributos.')).toBeInTheDocument();
  });

  it('confirmar, completar el requerido y aplicar datos al producto (pasos 2-4)', async () => {
    const { user, edit, store } = await auditFridge();
    await user.click(screen.getByRole('button', { name: 'Confirmar categoría' }));
    expect(screen.getByRole('heading', { name: 'Progreso de Validación - Frigorífico Combi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos Faltantes (1)' })).toBeInTheDocument();
    // El foco pasa al primer campo faltante (el botón pulsado ha desaparecido).
    expect(document.activeElement).toHaveAttribute('data-focus', 'drag:eficiencia_energetica');
    const apply = screen.getByRole('button', { name: /Aplicar datos a Atributos/ });
    expect(apply).toBeDisabled();
    expect(screen.getByText('Completa todos los campos requeridos antes de aplicar')).toBeInTheDocument();
    expect(solidButtons()).toBe(1);

    // Intro sobre el faltante lo lleva a la gestión; su lista aparece entre los campos.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Datos Faltantes (0)' })).toBeInTheDocument();
    expect(apply).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('eficiencia_energetica'), 'A');
    expect(apply).toBeEnabled();
    expect(screen.queryByText('Completa todos los campos requeridos antes de aplicar')).not.toBeInTheDocument();
    await user.click(apply);

    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ brand: 'Kelvia', price: '749', name: expect.stringMatching(/^Kelvia KCB-363NF/) }));
    const fields = store.get<CustomField[]>('customFields', []);
    expect(fields.find(field => field.name === 'Eficiencia energetica')).toMatchObject({ type: 'select', value: 'A' });
    expect(fields.find(field => field.name === 'Tecnologia no frost')).toMatchObject({ type: 'checkbox', value: true });
    const audit = store.get<AuditState>('audit');
    expect(audit).toMatchObject({ auditUrl: '', showSchemaComparison: false, editableFields: {} });
    expect(audit.auditResult).not.toBeNull(); // el resultado de Amazon se queda, como el original
    expect(document.activeElement).toBe(screen.getByLabelText('URL del Producto'));
  });

  it('mover un faltante a la gestión con teclado y crear un campo personalizado (E22, E23)', async () => {
    const { user, store } = await auditFridge();
    await user.click(screen.getByRole('button', { name: 'Confirmar categoría' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Campo "Eficiencia energetica" agregado a gestión')).toBeInTheDocument();
    expect(screen.getByText('¡Todos los campos movidos!')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nuevo Campo' }));

    await user.click(screen.getByRole('button', { name: 'Nuevo Campo' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Nombre del Campo'));
    await user.type(screen.getByLabelText('Nombre del Campo'), 'Garantía extendida');
    await user.type(screen.getByLabelText('Valor Inicial'), '3 años');
    await user.click(screen.getByRole('button', { name: 'Crear Campo' }));
    expect(await screen.findByText('Campo personalizado "Garantía extendida" creado')).toBeInTheDocument();
    expect(store.get<AuditState>('audit').editableFields['garantía_extendida']).toBe('3 años');
    const names = store.get<CustomField[]>('customFields', []).map(field => field.name);
    expect(names).toEqual(expect.arrayContaining(['Eficiencia energetica', 'Garantía extendida']));

    // Un nombre repetido no crea nada (E23).
    await user.click(screen.getByRole('button', { name: 'Nuevo Campo' }));
    await user.type(screen.getByLabelText('Nombre del Campo'), 'Garantía extendida');
    await user.click(screen.getByRole('button', { name: 'Crear Campo' }));
    expect(await screen.findByText('Ya existe un campo con ese nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del Campo')).toHaveFocus();
  });

  it('eliminar un campo lleva el foco al vecino', async () => {
    const { user } = await auditFridge();
    await user.click(screen.getByRole('button', { name: 'Confirmar categoría' }));
    const list = document.querySelector<HTMLElement>('[data-scroll="fields"]')!;
    await user.click(within(list).getByRole('button', { name: 'Eliminar sku' }));
    expect(screen.queryByLabelText('sku')).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('data-focus', 'remove:ean');
  });

  it('un error de la auditoría se avisa y deja la pestaña usable (MF2)', async () => {
    vi.mocked(auditProduct).mockRejectedValueOnce(new Error('Sin conexión. Revisa tu red e inténtalo de nuevo.'));
    vi.mocked(scrapeProduct).mockResolvedValueOnce({ error: 'La página no tiene datos de producto' });
    const user = userEvent.setup();
    renderTab(makeContext().context);
    await user.type(screen.getByLabelText('URL del Producto'), 'https://tienda.es/x');
    await user.click(screen.getByRole('button', { name: 'Auditar Producto' }));
    expect(await screen.findByText('❌ Error en auditoría: Sin conexión. Revisa tu red e inténtalo de nuevo.')).toBeInTheDocument();
    expect(await screen.findByText('La página no tiene datos de producto', { selector: '.pim-auditoria-error span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auditar Producto' })).toBeEnabled();
    expect(screen.getByLabelText('URL del Producto')).toBeEnabled();
  });
});
