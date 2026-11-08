import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VoiceTalkButton } from '@/shared/ui';
const speech = vi.hoisted(() => ({ mode: null, start: vi.fn() }));

it('la bienvenida de voz respeta No volver a mostrar y conserva esa elección entre cuentas', () => {
  localStorage.clear();
  const view = render(<VoiceTalkButton account="visitor" active={false} listen={() => speech.start('talk')} />);
  const trigger = screen.getByRole('button', { name: 'Hablar con Uony' });
  expect(trigger).toHaveClass('is-inviting');
  fireEvent.click(trigger);
  expect(speech.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'No volver a mostrar' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ahora no' }));
  expect(trigger).toHaveClass('is-inviting');
  fireEvent.click(trigger);
  expect(speech.start).toHaveBeenCalledWith('talk');
  view.unmount();
  const listen = vi.fn();
  render(<VoiceTalkButton account="nuevo@uonify.test" active={false} listen={listen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hablar con Uony' }));
  expect(listen).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
