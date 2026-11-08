import { fireEvent, render, screen } from '@testing-library/react';
import { VoiceAudioControls } from '../components/VoiceAudioControls';

test('dictado y controles de conversación ofrecen etiquetas, estados y acciones independientes', () => {
  const actions = { dictate: vi.fn(), toggleMicrophone: vi.fn(), toggleSpeaker: vi.fn() };
  const view = render(<VoiceAudioControls talking={false} dictating={false} microphoneMuted={false} speakerMuted={false} {...actions} />);
  const dictate = screen.getByRole('button', { name: 'Dictar' });
  expect(dictate).toHaveAttribute('data-tooltip', 'Dictar');
  fireEvent.click(dictate);
  expect(actions.dictate).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /altavoz/ })).toBeNull();
  view.rerender(<VoiceAudioControls talking dictating={false} microphoneMuted={false} speakerMuted={false} {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Silenciar micrófono' }));
  fireEvent.click(screen.getByRole('button', { name: 'Silenciar altavoz de Uony' }));
  expect(actions.toggleMicrophone).toHaveBeenCalledOnce();
  expect(actions.toggleSpeaker).toHaveBeenCalledOnce();
  expect(actions.dictate).toHaveBeenCalledOnce();
  view.rerender(<VoiceAudioControls talking dictating={false} microphoneMuted speakerMuted {...actions} />);
  expect(screen.getByRole('button', { name: 'Activar micrófono' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Activar altavoz de Uony' })).toHaveAttribute('data-tooltip', 'Activar altavoz de Uony');
});
