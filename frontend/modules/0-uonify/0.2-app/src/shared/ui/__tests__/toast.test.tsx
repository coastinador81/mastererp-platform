import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast, Toaster, TOAST_DURATION } from '@/shared/ui';

describe('avisos (UonifyPIM.toast)', () => {
  afterEach(() => {
    act(() => toast.dismiss());
    vi.useRealTimers();
  });

  test('pinta la región «Notificaciones» con el aviso y su descripción', () => {
    render(<Toaster />);
    act(() => { toast.success('Cambios guardados', { description: 'UON-KIT-01' }); });
    const region = screen.getByRole('region', { name: 'Notificaciones' });
    const item = within(region).getByRole('status');
    expect(item).toHaveClass('pim-toast', 'pim-toast-success');
    expect(item).toHaveTextContent('Cambios guardados');
    expect(item).toHaveTextContent('UON-KIT-01');
  });

  test('los errores se anuncian como alerta', () => {
    render(<Toaster />);
    act(() => { toast.error('No se ha podido guardar'); });
    expect(screen.getByRole('alert')).toHaveClass('pim-toast-error');
  });

  test('el más reciente arriba; se cierran solos a los 4 s salvo «loading»', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast.loading('Generando…', { id: 'job' });
      toast.info('Primero');
      toast('Segundo');
    });
    const items = () => screen.queryAllByRole('status').map(item => item.textContent);
    expect(items()).toEqual(['Segundo', 'Primero', 'Generando…']);
    act(() => { vi.advanceTimersByTime(TOAST_DURATION); });
    expect(items()).toEqual(['Generando…']);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(items()).toEqual(['Generando…']);
  });

  test('con el mismo id se actualiza en su sitio (loading → éxito)', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    let id: string | number = '';
    act(() => { id = toast.loading('Subiendo vídeo…'); });
    act(() => { toast.success('Vídeo subido', { id }); });
    const items = screen.getAllByRole('status');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveClass('pim-toast-success');
    act(() => { vi.advanceTimersByTime(TOAST_DURATION); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('duración propia, cierre por id y botón «Cerrar notificación»', async () => {
    render(<Toaster />);
    act(() => {
      toast.warning('Revisa el precio', { id: 7, duration: Infinity });
      toast('Otro');
    });
    act(() => { toast.dismiss(7); });
    expect(screen.queryByText('Revisa el precio')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar notificación' }));
    expect(screen.queryByText('Otro')).toBeNull();
  });

  test('toast devuelve el id dado o uno nuevo', () => {
    expect(toast('a', { id: 42 })).toBe(42);
    expect(String(toast('b'))).toMatch(/^toast-/);
  });
});
