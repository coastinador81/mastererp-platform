import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { Button, dialog, Dialog, DialogHost, toast, Toaster } from '@/shared/ui';

describe('diálogos (UonifyPIM.dialog)', () => {
  afterEach(() => {
    act(() => {
      dialog.close();
      toast.dismiss();
    });
  });

  function Opener({ onOpen }: { onOpen: () => void }) {
    return <button type="button" onClick={onOpen}>Abrir</button>;
  }

  test('open pinta título, descripción, cuerpo y acciones; una acción cierra con su valor', async () => {
    const onClose = vi.fn();
    render(<><Opener onOpen={() => dialog.open({
      title: 'Condiciones de los modelos de IA',
      description: 'Se aceptan una vez, antes de tu primer vídeo.',
      body: <p>Texto de las condiciones</p>,
      actions: [{ label: 'Cancelar', value: false }, { label: 'Aceptar y generar', variant: 'primary', value: true }],
      onClose,
    })} /><DialogHost /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const modal = screen.getByRole('dialog', { name: 'Condiciones de los modelos de IA' });
    expect(modal).toHaveClass('pim-dialog', 'pim-dialog-md');
    expect(modal).toHaveAccessibleDescription('Se aceptan una vez, antes de tu primer vídeo.');
    expect(screen.getByText('Texto de las condiciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar y generar' })).toHaveClass('pim-btn-primary');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('pim-btn-outline');
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar y generar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  test('una acción que devuelve true deja el diálogo abierto; update cambia sus opciones', async () => {
    render(<DialogHost />);
    act(() => {
      dialog.open({
        title: 'Publicar',
        actions: [{ label: 'Publicar', variant: 'primary', onClick: ({ update }) => { update({ title: 'Publicando…' }); return true; } }],
      });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(screen.getByRole('dialog', { name: 'Publicando…' })).toBeInTheDocument();
  });

  test('Escape y la X cierran; sin dismissible, Escape no', async () => {
    render(<DialogHost />);
    act(() => { dialog.open({ title: 'Uno' }); });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { dialog.open({ title: 'Dos' }); });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { dialog.open({ title: 'Tres', dismissible: false, actions: [{ label: 'Entendido' }] }); });
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Tres' })).toBeInTheDocument();
  });

  test('el foco entra en el primer control y vuelve a quien lo abrió', async () => {
    render(<><Opener onOpen={() => dialog.open({ title: 'Renombrar', body: <input aria-label="Nombre" /> })} /><DialogHost /></>);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  test('en StrictMode (doble efecto) sigue abierto y devuelve el foco', async () => {
    render(<StrictMode><Opener onOpen={() => dialog.open({ title: 'Estricto', body: <button type="button">Dentro</button> })} /><DialogHost /></StrictMode>);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Estricto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dentro' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  test('confirm resuelve true con la acción de confirmar y false al cancelar', async () => {
    render(<DialogHost />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => { answer = dialog.confirm({ title: '¿Eliminar este vídeo?', confirmLabel: 'Eliminar', destructive: true }); });
    expect(screen.getByRole('dialog')).toHaveClass('pim-dialog-sm');
    expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveClass('pim-btn-danger');
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await expect(answer).resolves.toBe(true);
    act(() => { answer = dialog.confirm({ title: '¿Volver a detectar las escenas?' }); });
    expect(screen.getByRole('button', { name: 'Continuar' })).toHaveClass('pim-btn-primary');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(answer).resolves.toBe(false);
  });

  test('los avisos se ven encima del diálogo abierto', () => {
    render(<><DialogHost /><Toaster /></>);
    act(() => { dialog.open({ title: 'Vista Previa de Imagen', size: 'xl' }); });
    act(() => { toast.info('Imagen descargada'); });
    const modal = screen.getByRole('dialog');
    expect(modal.querySelector('.pim-toaster')).not.toBeNull();
    act(() => { dialog.close(); });
    expect(document.body.querySelector(':scope > .pim-toaster')).not.toBeNull();
  });

  test('<Dialog> declarativo hereda el contexto y se cierra con onClose', async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Publicar</Button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Publicar «Make It Possible»" size="lg"
            footer={<Button variant="primary" onClick={() => setOpen(false)}>Listo</Button>}>
            <p>Canales</p>
          </Dialog>
        </>
      );
    }
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(screen.getByRole('dialog', { name: 'Publicar «Make It Possible»' })).toHaveClass('pim-dialog-lg');
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
