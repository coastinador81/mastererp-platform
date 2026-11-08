import { fireEvent, render, screen, within } from '@testing-library/react';
import { conversationFormOf } from '../model/conversationForm';
import { ConversationQuestion } from '../components/ConversationQuestion';

const evidence = Array.from({ length: 125 }, (_, index) => ({ sourceName: `Recurso ${index + 1}.png`,
  locator: `Fotograma 1 · Región ${index + 1}`, excerpt: `Marca visible ${index + 1}` }));
const context = { kind: 'drive_analysis', sku: 'BASIC', revision: 3, section: 'review',
  analysisId: '11111111-1111-4111-8111-111111111111', proposalIds: ['observation'] };
const field = { id: 'p0', label: 'Comprueba los recursos · Marca', type: 'select', required: true,
  closed: true, options: ['La lectura es incorrecta', 'El recurso contiene un error'], resourceEvidence: evidence };
const form = { id: 'resource-review', title: 'Revisar recursos', context, fields: [field] };

it('conserva todas las citas de Drive sin truncar la cantidad ni aceptar propiedades ejecutables', () => {
  const parsed = conversationFormOf({ ...form, fields: [{ ...field,
    resourceEvidence: evidence.map(entry => ({ ...entry, url: 'javascript:alert(1)', onclick: 'run()' })) }] }, 'assistant')!;
  expect(parsed.fields[0].resourceEvidence).toEqual(evidence);
  expect(parsed.fields[0].resourceEvidence).not.toBe(evidence);
  expect(parsed.fields[0].resourceEvidence?.at(-1)).toEqual(evidence.at(-1));
  expect(conversationFormOf({ ...form, fields: [{ ...field, resourceEvidence: Array(5000).fill(evidence[0]) }] }, 'assistant')?.fields[0].resourceEvidence).toHaveLength(5000);
});

it('rechaza todo el formulario si una cita no cumple el contrato en lugar de ocultarla al cliente', () => {
  for (const resourceEvidence of [null, {}, [], [evidence[0], null], [{ ...evidence[0], sourceName: '' }],
    [{ ...evidence[0], sourceName: 'n'.repeat(501) }], [{ ...evidence[0], locator: 'l'.repeat(501) }],
    [{ ...evidence[0], excerpt: 'e'.repeat(301) }], [{ ...evidence[0], excerpt: 'Texto\u0000oculto' }], Array(5001).fill(evidence[0])]) {
    expect(conversationFormOf({ ...form, fields: [{ ...field, resourceEvidence }] }, 'assistant')).toBeUndefined();
  }
  expect(conversationFormOf({ ...form, context: undefined }, 'assistant')).toBeUndefined();
  expect(conversationFormOf(form, 'user')).toBeUndefined();
});

it('muestra la lista completa y conserva la selección al expandirla sin abrir un modal', () => {
  const parsed = conversationFormOf(form, 'assistant')!;
  const change = vi.fn();
  const view = render(<ConversationQuestion field={parsed.fields[0]} value="" custom={false} disabled={false} change={change} />);
  expect(screen.getByText('Tu respuesta se aplicará a todos los recursos enumerados en esta lista.')).toBeVisible();
  expect(screen.getByText('Recurso 125.png')).not.toBeVisible();
  fireEvent.click(screen.getByText('Ver recursos y citas · 125'));
  expect(screen.getByText('Recurso 125.png')).toBeVisible();
  expect(screen.getByText('Marca visible 125')).toBeVisible();
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(125);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: 'El recurso contiene un error' }));
  expect(change).toHaveBeenLastCalledWith('El recurso contiene un error');
  view.rerender(<ConversationQuestion field={parsed.fields[0]} value="El recurso contiene un error" custom={false} disabled={false} change={change} />);
  fireEvent.click(screen.getByText('Ver recursos y citas · 125'));
  expect(screen.getByRole('radio', { name: 'El recurso contiene un error' })).toBeChecked();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('renderiza nombres y extractos como texto inerte sin interpretar HTML o enlaces de la fuente', () => {
  const entry = { sourceName: '<script>run()</script>', locator: 'https://external.test/source', excerpt: '<img src=x onerror=alert(1)>' };
  const parsed = conversationFormOf({ ...form, fields: [{ ...field, resourceEvidence: [entry] }] }, 'assistant')!;
  const { container } = render(<ConversationQuestion field={parsed.fields[0]} value="" custom={false} disabled={false} change={vi.fn()} />);
  fireEvent.click(screen.getByText('Ver recursos y citas · 1'));
  expect(screen.getByText(entry.sourceName)).toBeVisible();
  expect(screen.getByText(entry.excerpt)).toBeVisible();
  expect(container.querySelector('script,img,a')).toBeNull();
});
