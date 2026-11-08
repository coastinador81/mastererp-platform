import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pimStore } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { DEFAULT_AUDIT, UONIFY_SCHEMAS } from '../model/schemas';
import { validateFields } from '../model/validation';
import type { AuditState } from '../model/types';
import { makeContext, renderTab } from './renderTab';

// Las esperas simuladas (2 s de conexión, 1,5 s de búsqueda) se resuelven al momento.
vi.mock('@/shared/lib', async importOriginal => {
  const original = await importOriginal<typeof import('@/shared/lib')>();
  return { ...original, sleep: vi.fn(() => Promise.resolve()) };
});

const schema = UONIFY_SCHEMAS['Frigorífico Combi'];
const editableFields = { nombre: 'Kelvia KCB-363NF', marca: 'Kelvia', precio: 749 };

/** Producto con el esquema abierto: faltan modelo, capacidad_total y eficiencia_energetica. */
function seedSchema(key: string) {
  pimStore.set<AuditState>(key, 'audit', {
    ...DEFAULT_AUDIT,
    scrapedData: { sku: 'KCB-363NF-IX' },
    mappedFields: editableFields,
    editableFields,
    suggestedCategory: 'Frigorífico Combi',
    isCategoryConfirmed: true,
    selectedCategory: 'Frigorífico Combi',
    uonifySchema: schema,
    showSchemaComparison: true,
    ...validateFields(schema, editableFields),
  });
}

beforeEach(() => {
  pimStore.clear();
});
afterEach(() => {
  toast.dismiss();
});

describe('Conexiones API Externas (simulada)', () => {
  it('valida los campos y permite buscar y aplicar resultados', async () => {
    const user = userEvent.setup();
    const { context, store } = makeContext();
    seedSchema(context.key);
    renderTab(context);
    await user.click(screen.getByRole('button', { name: 'Completar con API' }));
    const dialog = screen.getByRole('dialog', { name: 'Conexiones API Externas' });
    expect(within(dialog).getByRole('tab', { name: 'Buscar Producto' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: /Google Sheets/ }));
    await user.click(within(dialog).getByRole('button', { name: /Probar Conexión/ }));
    expect(await screen.findByText('Completa los campos requeridos: ID de Hoja de Cálculo, API Key de Google')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/ID de Hoja de Cálculo/), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    const apiKey = within(dialog).getByLabelText(/API Key de Google/, { selector: 'input' });
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveAttribute('aria-required', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Mostrar API Key de Google' }));
    expect(apiKey).toHaveAttribute('type', 'text');
    await user.type(apiKey, 'AIzaSyC-clave-de-prueba');
    await user.click(within(dialog).getByRole('button', { name: /Probar Conexión/ }));

    const badge = await within(dialog).findByText('Campos completos', { selector: '.pim-auditoria-status-badge' });
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveClass('pim-badge-blue');
    expect(within(dialog).queryByText('Conectado')).not.toBeInTheDocument();
    expect(await screen.findByText('Campos completos. Puedes continuar con la búsqueda.')).toBeInTheDocument();
    expect(screen.queryByText(/Conexión exitosa/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('tab', { name: 'Buscar Producto' }));
    expect(within(dialog).getByLabelText('Buscar Producto', { selector: 'input' })).toHaveValue('KCB-363NF-IX');
    await user.click(within(dialog).getByRole('button', { name: 'Buscar Producto' }));
    expect(await within(dialog).findByText('Producto KCB-363NF-IX')).toBeInTheDocument();
    expect(within(dialog).getByText('Fuente: Google Sheets')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Usar Datos/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('5 campos aplicados')).toBeInTheDocument();
    expect(store.get<AuditState>('audit').editableFields).toMatchObject({ peso: '2.8 kg', 'garantía': '24 meses', materiales: 'Aluminio, Plástico ABS' });
  });

  it('credenciales demasiado cortas: error sin conexión', async () => {
    const user = userEvent.setup();
    const { context } = makeContext();
    seedSchema(context.key);
    renderTab(context);
    await user.click(screen.getByRole('button', { name: 'Completar con API' }));
    const dialog = screen.getByRole('dialog', { name: 'Conexiones API Externas' });
    await user.click(within(dialog).getByRole('button', { name: /PrestaShop/ }));
    await user.type(within(dialog).getByLabelText(/URL de la Tienda/), 'a.es');
    await user.type(within(dialog).getByLabelText(/Web Service Key/, { selector: 'input' }), 'corta');
    await user.click(within(dialog).getByRole('button', { name: /Probar Conexión/ }));
    expect(await within(dialog).findByText('Error', { selector: '.pim-auditoria-status-badge' })).toHaveClass('pim-badge-red');
    expect(await screen.findByText('Credenciales incompletas: revisa que las hayas copiado enteras.')).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Buscar Producto' })).toBeDisabled();
  });
});

describe('Procesamiento Inteligente de Documentos', () => {
  it('lee un TXT, encuentra los campos faltantes y los aplica', async () => {
    const user = userEvent.setup();
    const { context, store } = makeContext();
    seedSchema(context.key);
    renderTab(context);
    await user.click(screen.getByRole('button', { name: 'Completar desde documentos' }));
    const dialog = screen.getByRole('dialog', { name: 'Procesamiento Inteligente de Documentos' });
    expect(within(dialog).getByRole('button', { name: 'Seleccionar Archivos' })).toHaveFocus();

    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['Modelo: KCB-363NF\nEficiencia energetica: C\nColor: Inox\n'], 'ficha-tecnica.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await within(dialog).findByText('2 campos encontrados')).toBeInTheDocument();
    expect(within(dialog).getByText('ficha-tecnica.txt')).toHaveClass('pim-mono');
    expect(await screen.findByText('1 archivo(s) procesado(s)')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Aplicar 2 Campos/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('2 campos completados desde documentos')).toBeInTheDocument();
    const audit = store.get<AuditState>('audit');
    expect(audit.editableFields).toMatchObject({ modelo: 'KCB-363NF', eficiencia_energetica: 'C' });
    expect(audit.missingFields).toEqual(['capacidad_total']);
  });

  it('rechaza tipos no admitidos y avisa de un JSON inválido', async () => {
    const user = userEvent.setup();
    const { context } = makeContext();
    seedSchema(context.key);
    renderTab(context);
    await user.click(screen.getByRole('button', { name: 'Completar desde documentos' }));
    const dialog = screen.getByRole('dialog', { name: 'Procesamiento Inteligente de Documentos' });
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['x'], 'foto.png', { type: 'image/png' })] } });
    expect(await screen.findByText('Tipo de archivo no soportado. Usa CSV, XLSX, PDF, TXT o JSON')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(['{'], 'datos.json', { type: 'application/json' })] } });
    expect(await within(dialog).findByText('JSON inválido')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Aplicar/ })).not.toBeInTheDocument();
  });
});
