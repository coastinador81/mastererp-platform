import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportChat } from '../components/SupportChat';
import { streamAssistant } from '../api/assistantStream';

vi.mock('../api/assistantStream', () => ({ streamAssistant: vi.fn() }));
const stream = vi.mocked(streamAssistant);
beforeEach(() => {
  stream.mockReset();
  stream.mockImplementation(async (_request, event) => {
    event({ type: 'delta', text: 'Puedes elegir pago mensual o anual.' });
    event({ type: 'done', handoff: null, filtered: false });
  });
});

test('Enter envía; Mayús+Enter conserva el salto de línea y no envía', async () => {
  const user = userEvent.setup();
  render(<SupportChat />);
  const input = screen.getByRole('textbox', { name: 'Tu pregunta para Uony' });
  await user.type(input, 'Primera línea');
  await user.keyboard('{Shift>}{Enter}{/Shift}Segunda línea');
  expect(input).toHaveValue('Primera línea\nSegunda línea');
  expect(stream).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(stream).toHaveBeenCalledTimes(1);
  expect(stream.mock.calls[0][0].message).toBe('Primera línea\nSegunda línea');
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(await screen.findByText('Puedes elegir pago mensual o anual.')).toBeVisible();
});

test('no envía espacios ni Enter durante la composición de texto', async () => {
  render(<SupportChat />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'Hola' } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(stream).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
});

test('evita envíos duplicados mientras responde y conserva el siguiente borrador', async () => {
  let finish!: () => void;
  stream.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<SupportChat />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Primero' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'Después' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(stream).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('Después');
  expect(screen.getByRole('button', { name: 'Uony está respondiendo' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Enviar mensaje con Uony' })).toBeEnabled();
});

test('el botón envía y al cerrar se cancela la petición', async () => {
  stream.mockImplementation(() => new Promise<void>(() => {}));
  const { unmount } = render(<SupportChat />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ayuda' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje con Uony' }));
  const signal = stream.mock.calls[0][2];
  unmount();
  expect(signal?.aborted).toBe(true);
});
