import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MaterialAnalysisJob, MaterialFact, MaterialResolution, MaterialResolutionIssue } from '../api/productMaterials';
import { MaterialAnalysisResults } from '../components/MaterialAnalysisResults';

const resolution: MaterialResolution = { version: 1, processedSources: 95, completeSources: 95, technicalPendingCount: 0, clientPendingCount: 0,
  discardedProposalCount: 212, historicalRejectionCount: 132, resolvedCount: 3, issues: [] };
const fact: MaterialFact = { id: 'f1', field: 'brand', canonicalField: 'brand', label: 'Marca', value: 'Uonify', normalizedValue: 'uonify', scope: 'product',
  channel: 'product', claimType: 'declared', supportStatus: 'supported', supportReasons: [], reviewable: true, sourceProposalIds: ['p1'], originalValues: ['Uonify'], status: 'proposed', evidence: [] };
const job: MaterialAnalysisJob = { id: 'resolution-test', sku: 'BASIC', revision: 3, status: 'ready', total: 95, processed: 95, folderId: 'folder', folderName: 'Basic Mini Bricks',
  sources: [{ id: 's1', name: 'pack.png', mimeType: 'image/png', status: 'partial', readingCoverage: { complete: true }, resolutionSummary: { technicalPendingCount: 0, historicalDiscardCount: 2 } }],
  proposals: [], warnings: ['2 propuestas descartadas por falta de cita.'], facts: { version: 1, proposals: [fact], rejections: [] }, resolution,
  coverage: { sourcesTotal: 95, sourcesRead: 95, fragmentsTotal: 2961, fragmentsDone: 2961, fragmentsPending: 0, fragmentsNeedingReview: 79 } };

it('distingue el procesamiento de la lectura completa y conserva los descartes sin alarma ni nuevas preguntas', () => {
  render(<MaterialAnalysisResults job={job} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('95 de 95 archivos procesados')).toBeVisible();
  expect(screen.getByText('95 de 95 archivos con lectura completa')).toBeVisible();
  expect(screen.getByText('Lectura completa. Los datos están disponibles para comprobar los requisitos de Amazon.')).toBeVisible();
  expect(screen.queryByText(/79/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).toBeEnabled();
  expect(document.querySelector('.drive-analysis-warnings')).toBeNull();
  fireEvent.click(screen.getByText('Historial de la revisión'));
  expect(screen.getByText(/212 propuestas descartadas/)).toBeVisible();
  expect(screen.getByText(/132 descartes registrados en análisis anteriores/)).toBeVisible();
  fireEvent.click(screen.getByText('Ver archivos y estado · 1'));
  expect(screen.getByText('Lectura completa')).toBeVisible();
  expect(screen.queryByText('Análisis parcial')).not.toBeInTheDocument();
});

it('no llama lectura completa al ZIP con dos miembros pendientes aunque los 95 archivos estén procesados', () => {
  const reading = { ...resolution, completeSources: 94, technicalPendingCount: 1, issues: [{ id: 'zip', kind: 'reading' as const, status: 'pending' as const, title: 'Dos elementos pendientes', detail: 'Aporta una versión PDF o SVG de los elementos AI y EPS.', sourceId: 'zip', action: 'replace_source' as const }] };
  render(<MaterialAnalysisResults job={{ ...job, resolution: reading, sources: [{ id: 'zip', name: 'ce-oficial.zip', mimeType: 'application/zip', status: 'partial', readingCoverage: { complete: false, entriesRead: 3, entriesPending: 2 }, resolutionSummary: { technicalPendingCount: 1, historicalDiscardCount: 0 } }] }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('95 de 95 archivos procesados')).toBeVisible();
  expect(screen.getByText('94 de 95 archivos con lectura completa')).toBeVisible();
  expect(screen.queryByText(/^Lectura completa\./)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Qué falta por resolver · 1'));
  expect(screen.getByText('Aporta una versión PDF o SVG de los elementos AI y EPS.')).toBeVisible();
  expect(screen.getAllByText('ce-oficial.zip').some(element => element.closest('.drive-resolution'))).toBe(true);
});

it('mantiene pendientes del cliente separadas de incidencias técnicas y abre la revisión existente', () => {
  const review = vi.fn();
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, clientPendingCount: 1 } }} disabled={false} onReview={review} />);
  expect(screen.getByText('Lectura completa. Los datos están disponibles para comprobar los requisitos de Amazon.')).toBeVisible();
  expect(screen.queryByText(/No quedan datos/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' }));
  expect(review).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('no ofrece preguntas sobre hechos no revisables ni atribuye conformidad a una referencia', () => {
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, clientPendingCount: 1 }, facts: { version: 1, rejections: [], proposals: [{ ...fact, reviewable: false, channel: 'safety', claimType: 'certified_claim' }, { ...fact, id: 'ref', reviewable: false, channel: 'reference' }] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).toBeEnabled();
  fireEvent.click(screen.getByText('Seguridad y conformidad · 1'));
  expect(screen.getByText('Una mención o un símbolo no acredita por sí solo la conformidad del producto.')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sobre seguridad y conformidad' }));
  expect(screen.getByText('Una mención o un símbolo no acredita por sí solo la conformidad del producto.')).toBeVisible();
  fireEvent.click(screen.getByText('Referencias externas · 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Sobre referencias externas' }));
  expect(screen.getByText(/no se atribuye a este producto/)).toBeVisible();
});

it('pagina incidencias pendientes sin incluir las resueltas o descartadas', () => {
  const issues = Array.from({ length: 54 }, (_, index) => ({ id: `i${index}`, kind: 'evidence' as const, status: 'pending' as const, title: `Revisión ${index + 1}`, detail: 'Volver a contrastar la cita.' }));
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, technicalPendingCount: 54, issues: [...issues, { ...issues[0], id: 'done', status: 'resolved', title: 'Revisión ya resuelta' }] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Qué falta por resolver · 54'));
  expect(screen.getByText('Revisión 50')).toBeVisible();
  expect(screen.queryByText('Revisión 51')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de comprobaciones pendientes' })).getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Revisión 54')).toBeVisible();
  expect(screen.queryByText('Revisión ya resuelta')).not.toBeInTheDocument();
});

it('el estado antiguo no deduce lectura completa solo de fuentes procesadas', () => {
  render(<MaterialAnalysisResults job={{ ...job, resolution: undefined }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('95 de 95 archivos procesados')).toBeVisible();
  expect(screen.queryByText('95 de 95 archivos con lectura completa')).not.toBeInTheDocument();
  expect(screen.getByText(/los descartes registrados no equivalen a datos que debas completar/)).toBeVisible();
});

it.each(['paused', 'error'] as const)('no da por finalizada una lectura %s con todas las fuentes conocidas procesadas', status => {
  render(<MaterialAnalysisResults job={{ ...job, status, pauseReason: 'discovery_limit' }} disabled={false} onReview={vi.fn()} />);
  expect(screen.queryByText(/^Lectura completa\./)).not.toBeInTheDocument();
  expect(screen.getByText('El avance está guardado. La lectura aún no se ha dado por finalizada.')).toBeVisible();
});

it('no declara revisión terminada cuando cambió la fuente de los hechos', () => {
  render(<MaterialAnalysisResults job={{ ...job, facts: { ...job.facts!, stale: true } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.queryByText(/No quedan datos por revisar/)).not.toBeInTheDocument();
  expect(screen.getByText('Los datos esperan una nueva comprobación de sus fuentes.')).toBeVisible();
});

const sourceIssue: MaterialResolutionIssue = { id: 'source-issue', kind: 'client', status: 'awaiting_source', action: 'replace_source',
  sourceId: 'drive-source-12345', factId: 'visual-observation', title: 'Corregir el código de barras del packaging',
  detail: 'El EAN visible en este recurso no coincide con el dato confirmado.' };

it('muestra la fuente que debe corregirse sin fingir cierre ni ofrecer una pregunta o botón vacío', () => {
  render(<MaterialAnalysisResults job={{ ...job, sources: [{ ...job.sources[0], id: sourceIssue.sourceId!, name: 'packaging-posterior.png' }],
    resolution: { ...resolution, sourcePendingCount: 1, issues: [sourceIssue] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('Lectura completa. Queda 1 recurso por corregir o aportar.')).toBeVisible();
  expect(screen.queryByText(/No quedan datos por revisar/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Qué falta por resolver/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).toBeEnabled();
  const resources = screen.getByText('Recursos por corregir o aportar · 1').closest('details')!;
  expect(within(resources).getByText(sourceIssue.detail)).toBeVisible();
  expect(within(resources).getByRole('link', { name: 'packaging-posterior.png' })).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-source-12345/view');
  expect(within(resources).getByText('Siguiente paso: corrige o aporta este recurso en la carpeta de Drive y solicita un nuevo análisis a Uony.')).toBeVisible();
  expect(within(resources).queryByRole('button')).not.toBeInTheDocument();
});

it('conserva las preguntas disponibles y cuenta los recursos pendientes por separado', () => {
  const review = vi.fn();
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, clientPendingCount: 1, sourcePendingCount: 2,
    issues: [sourceIssue, { ...sourceIssue, id: 'source-issue-2', title: 'Aportar una imagen legible' }] } }} disabled={false} onReview={review} />);
  expect(screen.getByText('Lectura completa. Quedan 2 recursos por corregir o aportar.')).toBeVisible();
  expect(screen.queryByText(/dato propuesto para revisar/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' }));
  expect(review).toHaveBeenCalledOnce();
});

it('tolera el contador opcional y excluye recursos resueltos o descartados', () => {
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, issues: [sourceIssue,
    { ...sourceIssue, id: 'resolved-source', status: 'resolved', title: 'Recurso ya corregido' },
    { ...sourceIssue, id: 'discarded-source', status: 'discarded', title: 'Recurso descartado' }] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('Lectura completa. Queda 1 recurso por corregir o aportar.')).toBeVisible();
  expect(screen.queryByText('Recurso ya corregido')).not.toBeInTheDocument();
  expect(screen.queryByText('Recurso descartado')).not.toBeInTheDocument();
});

it('pagina los recursos pendientes sin mezclarlos con comprobaciones técnicas', () => {
  const resources = Array.from({ length: 51 }, (_, index) => ({ ...sourceIssue, id: `source-${index}`, title: `Recurso ${index + 1}` }));
  render(<MaterialAnalysisResults job={{ ...job, resolution: { ...resolution, sourcePendingCount: 51, technicalPendingCount: 1,
    issues: [...resources, { id: 'technical', kind: 'evidence', status: 'pending', title: 'Contrastar evidencia', detail: 'Verificar la cita.' }] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('Recurso 50')).toBeVisible();
  expect(screen.queryByText('Recurso 51')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de recursos por corregir o aportar' })).getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Recurso 51')).toBeVisible();
  fireEvent.click(screen.getByText('Qué falta por resolver · 1'));
  expect(screen.getByText('Contrastar evidencia')).toBeVisible();
});
