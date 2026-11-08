import { useState } from 'react';
import { DISMISSED_SUGGESTIONS_KEY } from '../../model/composerOptions';
import { readSession, saveSession } from '../../model/storage';

export const PROMPT_SUGGESTIONS: ReadonlyArray<{ id: string; label: string; prompt: string }> = [
  { id: 'publish-amazon', label: 'Publicar un producto en Amazon', prompt: 'Quiero publicar un producto en Amazon desde cero.' },
  { id: 'search-drive', label: 'Buscar en mi Google Drive', prompt: 'Busca el producto en mi Google Drive.' },
  { id: 'social-video', label: 'Crear un vídeo para redes', prompt: 'Hazme un vídeo para redes de mi producto.' },
];

/**
 * «Ideas para empezar» bajo el compositor: rellenan el campo; la × las quita y la
 * elección se recuerda en la pestaña (la comparte el espacio de trabajo).
 */
export function PromptSuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  const [dismissed, setDismissed] = useState<string[]>(() => readSession<string[]>(DISMISSED_SUGGESTIONS_KEY, []));
  const dismiss = (id: string) => {
    const next = [...new Set([...readSession<string[]>(DISMISSED_SUGGESTIONS_KEY, []), ...dismissed, id])];
    saveSession(DISMISSED_SUGGESTIONS_KEY, next);
    setDismissed(next);
  };
  return (
    <div className="prompt-suggestions" aria-label="Ideas para empezar">
      {PROMPT_SUGGESTIONS.map(item => (
        <div className="prompt-suggestion" data-suggestion-id={item.id} key={item.id} hidden={dismissed.includes(item.id)}>
          <button type="button" data-prompt-suggestion={item.prompt} onClick={() => onPick(item.prompt)}>{item.label}</button>
          <button type="button" data-suggestion-dismiss aria-label={`Quitar sugerencia: ${item.label}`} onClick={() => dismiss(item.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
