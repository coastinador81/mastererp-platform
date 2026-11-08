import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConversationMessages } from '../components/ConversationMessages';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: null }) }));

beforeEach(() => {
  resetWorkspaceStore();
  setUi({ pendingReply: null });
  useWorkspaceStore.setState({
    activeThreadId: 'voice-and-text',
    threads: [{ id: 'voice-and-text', title: 'Mi producto', service: null, view: 'default', messages: [
      { role: 'assistant', text: 'Hablamos por voz.', model: 'gemini-3.8-live' },
      { role: 'assistant', text: 'Seguimos por texto.', model: 'gemini-3.5-flash', effort: 'medium' },
    ] }],
  });
});

// D-PROTECCIÓN (CEO 30-10): el pie de la burbuja NUNCA debe exponer el motor real ni el nivel de razonamiento
// (antes salía «Gemini 3.5 Flash · Medio» / «Gemini 3.8-live» en todas las burbujas, todas las vistas). Ahora solo marca «Uony».
it('el pie de la burbuja no expone el motor ni el razonamiento: solo marca «Uony»', () => {
  render(<MemoryRouter><ConversationMessages centredInService={false} /></MemoryRouter>);
  // Ningún id de motor ni nivel visibles en el pie.
  expect(screen.queryByText(/Gemini/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Flash|Pro|live/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/· Medio|· Bajo|· Alto/)).not.toBeInTheDocument();
  // Las dos burbujas del asistente llevan el pie de marca «Uony».
  expect(screen.getAllByText('Uony')).toHaveLength(2);
});
