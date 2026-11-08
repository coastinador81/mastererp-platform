import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceTalkButton } from '../components/VoiceWelcome';

const session = vi.hoisted(() => ({ status: 'ready', user: { email: '' } }));
vi.mock('../components/authBridge', () => ({ useSession: () => session }));
let accountNumber = 0;
beforeEach(() => {
  localStorage.clear();
  session.status = 'ready';
  session.user.email = `voice-${++accountNumber}@uonify.test`;
});
const button = () => screen.getByRole('button', { name: 'Hablar con Uony' });

describe('Preferencia explícita de bienvenida de voz', () => {
  it('cerrar sin marcar la casilla conserva el foco y vuelve a mostrar el mensaje al remontar', () => {
    const listen = vi.fn();
    const view = render(<VoiceTalkButton active={false} listen={listen} />);
    expect(screen.queryByText(/Te recomendamos/)).not.toBeInTheDocument();
    expect(button()).toHaveClass('is-inviting');
    button().focus(); fireEvent.click(button());
    expect(listen).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Cuéntaselo a Uony' });
    expect(within(dialog).getByText(/Te recomendamos hablar con Uony/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ahora no' }));
    expect(button()).toHaveFocus();
    expect(button()).toHaveClass('is-inviting');
    expect(localStorage.getItem(`uonify-voice-intro-dismissed:${session.user.email}`)).toBeNull();
    view.unmount();
    render(<VoiceTalkButton active={false} listen={listen} />);
    expect(button()).toHaveClass('is-inviting');
    fireEvent.click(button());
    expect(listen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('empieza a escuchar solo al pulsar la acción del pop-up', () => {
    const listen = vi.fn();
    render(<VoiceTalkButton active={false} listen={listen} />);
    fireEvent.click(button());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hablar con Uony' }));
    expect(listen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('respeta el indicador persistido y ofrece el mensaje a otra cuenta', () => {
    localStorage.setItem(`uonify-voice-intro-dismissed:${session.user.email}`, '1');
    const listen = vi.fn();
    const view = render(<VoiceTalkButton active={false} listen={listen} />);
    expect(button()).toHaveClass('is-inviting');
    fireEvent.click(button());
    expect(listen).toHaveBeenCalledOnce();
    session.user.email = `new-${accountNumber}@uonify.test`;
    view.rerender(<VoiceTalkButton active={false} listen={listen} />);
    fireEvent.click(button());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button()).toHaveClass('is-inviting');
  });
  it('solo omite el pop-up tras guardar la casilla marcada, también al remontar', () => {
    const listen = vi.fn();
    const view = render(<VoiceTalkButton active={false} listen={listen} />);
    fireEvent.click(button());
    const checkbox = screen.getByRole('checkbox', { name: 'No volver a mostrar' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ahora no' }));
    expect(listen).not.toHaveBeenCalled();
    expect(localStorage.getItem(`uonify-voice-intro-dismissed:${session.user.email}`)).toBe('1');
    view.unmount();
    render(<VoiceTalkButton active={false} listen={listen} />);
    expect(button()).toHaveClass('is-inviting');
    fireEvent.click(button());
    expect(listen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('ignora el antiguo visto automático y permite desmarcar antes de cerrar con Escape', () => {
    localStorage.setItem(`uonify-voice-intro-seen:${session.user.email}`, '1');
    const listen = vi.fn();
    render(<VoiceTalkButton active={false} listen={listen} />);
    fireEvent.click(button());
    const checkbox = screen.getByRole('checkbox', { name: 'No volver a mostrar' });
    fireEvent.click(checkbox); fireEvent.click(checkbox);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(button());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(listen).not.toHaveBeenCalled();
  });
  it('el botón de detener voz no muestra la bienvenida', () => {
    const listen = vi.fn();
    render(<VoiceTalkButton active listen={listen} />);
    expect(screen.getByRole('button', { name: 'Terminar conversación de voz' })).not.toHaveClass('is-inviting');
    fireEvent.click(screen.getByRole('button', { name: 'Terminar conversación de voz' }));
    expect(listen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
