import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createPimStore, PimTabProvider, type PimProduct, type PimTabContext } from '@/shared/pim';
import { tab } from '../index';
import type { AplusSlice } from '../model/types';
import { setupAplusServer } from './mockServer';

setupAplusServer();

function renderTab(product: PimProduct, slices: Record<string, unknown> = {}) {
  const store = createPimStore({ storage: null });
  const scope = store.scope(product.sku);
  Object.entries(slices).forEach(([slice, value]) => scope.set(slice, value));
  const ctx: PimTabContext = {
    key: product.sku,
    isNew: false,
    product,
    store: scope,
    draft: () => product,
    edit: () => {},
    persist: async () => product,
    skuTaken: () => false,
    channels: () => ({ Amazon: Boolean(product.asin) }),
    switchTab: () => {},
  };
  const Tab = tab.component;
  render(
    <PimTabProvider value={ctx}>
      <Tab />
    </PimTabProvider>,
  );
  return scope;
}

const product: PimProduct = { sku: 'UON-KIT-01', name: 'Make It Possible by Uonify', brand: 'Uonify', category: 'Juguetes', description: '' };

describe('pestaña A+', () => {
  it('declara la pestaña «A+» con su clave', () => {
    expect(tab).toMatchObject({ key: 'aplus', label: 'A+', icon: 'sparkles' });
  });

  it('sin módulos muestra el estado vacío y «Añadir módulo» como acción sólida', () => {
    renderTab(product);
    expect(screen.getByRole('heading', { level: 2, name: 'Contenido A+' })).toBeInTheDocument();
    expect(screen.getByText('Comienza creando tu primer módulo')).toBeVisible();
    expect(screen.getByText('0 módulos creados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir módulo' })).toHaveClass('pim-btn-primary');
    expect(screen.queryByRole('button', { name: 'Publicar en Amazon' })).toBeNull();
  });

  it('añade un módulo desde el selector de tipos, lo valida y cuenta sus caracteres', async () => {
    const user = userEvent.setup();
    renderTab(product);
    await user.click(screen.getByRole('button', { name: 'Añadir módulo' }));
    const picker = screen.getByRole('dialog', { name: 'Selecciona el tipo de módulo' });
    await user.click(within(picker).getByText('Superposición de texto oscuro e imagen estándar'));

    expect(screen.queryByRole('dialog')).toBeNull();
    const card = screen.getByRole('article', { name: 'Superposición de texto oscuro e imagen estándar' });
    expect(within(card).getByText('Módulo 1')).toBeInTheDocument();
    expect(screen.getByText('Cambios sin guardar')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Añadir módulo' })).toHaveClass('pim-btn-outline');
    expect(screen.getByRole('button', { name: 'Publicar en Amazon' })).toHaveClass('pim-btn-primary');

    expect(await within(card).findByText('3 errores', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(within(card).getByText('• El titular es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('0/1 válidos')).toBeInTheDocument();

    const headline = within(card).getByLabelText(/Titular/);
    fireEvent.change(headline, { target: { value: 'Precio especial' } });
    expect(within(card).getByText('15/70 caracteres')).toBeInTheDocument();
    expect(await within(card).findByText('• No se permiten referencias a precios', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('elimina un módulo y deja el foco en «Añadir módulo»', async () => {
    const user = userEvent.setup();
    renderTab(product);
    await user.click(screen.getByRole('button', { name: 'Añadir módulo' }));
    await user.click(within(screen.getByRole('dialog')).getByText('Cuatro imágenes y texto estándares'));
    expect(screen.getAllByText(/^Sección \d$/)).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Eliminar módulo' }));
    expect(screen.getByText('Comienza creando tu primer módulo')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Añadir módulo' })).toHaveFocus());
  });

  it('restaura los módulos guardados de un producto sin ASIN', () => {
    const slice: AplusSlice = {
      content: {
        local: {
          timestamp: 1,
          data: {
            modules: [{ id: 'm1', type: 'specifications', title: 'Detalles de especificaciones y una sola imagen estándar', content: { mainHeadline: 'Dentro de la caja', bulletPoints: [] } as never, isValid: true, validationErrors: [] }],
            brand: 'Uonify',
            hasUnsavedChanges: false,
            availableDocuments: [],
            selectedDocumentKey: '',
          },
        },
      },
    };
    renderTab(product, { aplus: slice });
    expect(screen.getByText('1 módulo creado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dentro de la caja')).toBeInTheDocument();
    // A10: la lista vacía de viñetas deja una editable; el bloque vacío también aparece.
    expect(screen.getByRole('textbox', { name: 'Viñeta 1' })).toBeInTheDocument();
    expect(screen.getByText('Bloque 1')).toBeInTheDocument();
    expect(screen.getByText('Cambios sin guardar')).not.toBeVisible();
  });

  it('con ASIN carga el contenido publicado y lo muestra en el selector de documento', async () => {
    renderTab({ ...product, asin: 'B0TESTTAB01' });
    expect(await screen.findByText('3 módulos creados', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('B0TESTTAB01', { selector: '.pim-aplus-asin' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Make It Possible: todo empieza jugando.')).toBeInTheDocument();
    // Un solo documento: sin selector.
    expect(screen.queryByRole('combobox', { name: 'Documento A+' })).toBeNull();
  });
});
