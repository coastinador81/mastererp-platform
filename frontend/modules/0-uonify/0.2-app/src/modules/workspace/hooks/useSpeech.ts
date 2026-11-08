import type { RefObject } from 'react';
import type { ListeningMode } from './composerStore';
import { toggleVoice } from './voiceSession';

/** El controlador sobrevive a los cambios de posición del compositor. */
export function useSpeech(_form: RefObject<HTMLFormElement | null>, _draft: RefObject<HTMLTextAreaElement | null>): (mode: Exclude<ListeningMode, null>) => void {
  return toggleVoice;
}
