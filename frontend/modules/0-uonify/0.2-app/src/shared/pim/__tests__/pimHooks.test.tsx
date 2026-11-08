import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  pimStore,
  PimTabHost,
  usePimSlice,
  usePimStore,
  useTabContext,
  type PimTabContext,
  type PimTabDefinition,
} from '@/shared/pim';

function makeContext(key: string): PimTabContext {
  return {
    key,
    isNew: key === '__new__',
    product: null,
    store: pimStore.scope(key),
    draft: () => ({ ...pimStore.get(key, 'edited', {}) }),
    edit: patch => { pimStore.update<Record<string, unknown>>(key, 'edited', edited => ({ ...edited, ...patch }), {}); },
    persist: async data => ({ sku: String(data.sku), name: String(data.name) }),
    skuTaken: () => false,
    channels: () => ({ Amazon: false }),
    switchTab: () => {},
  };
}

function Bullets() {
  const { key } = useTabContext();
  const [bullets, setBullets] = usePimSlice<string[]>('bullets', []);
  return (
    <div>
      <p data-testid="key">{key}</p>
      <p data-testid="count">{bullets.length}</p>
      <button type="button" onClick={() => setBullets(list => [...list, `Viñeta ${list.length + 1}`])}>Añadir</button>
    </div>
  );
}

const tab: PimTabDefinition = { key: 'descripciones', label: 'Descripciones', icon: null, component: Bullets };

describe('hooks del almacén y contexto de la pestaña', () => {
  beforeEach(() => pimStore.clear());

  test('PimTabHost monta la pestaña con sus clases y su contexto', async () => {
    const { container } = render(<PimTabHost tab={tab} context={makeContext('UON-1')} />);
    expect(container.firstElementChild).toHaveClass('pim-tab', 'pim-tab-descripciones');
    expect(screen.getByTestId('key')).toHaveTextContent('UON-1');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(pimStore.get('UON-1', 'bullets')).toEqual(['Viñeta 1', 'Viñeta 2']);
  });

  test('vuelve a pintar cuando otra pestaña o un trabajo escribe la porción', () => {
    render(<PimTabHost tab={tab} context={makeContext('UON-2')} />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    act(() => { pimStore.scope('UON-2').set('bullets', ['a', 'b', 'c']); });
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });

  test('usePimStore da todas las porciones del producto', () => {
    function Summary() {
      const product = usePimStore('UON-3');
      return <p data-testid="slices">{Object.keys(product.values).sort().join(',')}</p>;
    }
    render(<Summary />);
    act(() => {
      pimStore.set('UON-3', 'gpsr', {});
      pimStore.set('UON-3', 'audit', {});
    });
    expect(screen.getByTestId('slices')).toHaveTextContent('audit,gpsr');
  });

  test('useTabContext fuera de una ficha explica el error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bullets />)).toThrow(/PimTabProvider/);
    error.mockRestore();
  });
});
