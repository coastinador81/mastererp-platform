import { useState } from 'react';
import { InformationDisclosure } from '@/shared/ui';
import { customerText, customerLocation } from '@/shared/lib/customerText';
import type { MaterialAnalysisJob, MaterialChannel, MaterialEvidence, MaterialFact, MaterialSource } from '../api/productMaterials';
import { MaterialPagination } from './MaterialAnalysisLists';
import { MaterialEvidenceLocation } from './MaterialReadingDetails';
import { MaterialSourceName } from './MaterialSourceName';

const PAGE_SIZE = 50;
const channels: { key: MaterialChannel; label: string; explanation: string }[] = [
  { key: 'product', label: 'Datos del producto', explanation: 'Uony contrasta los datos de tus documentos con los requisitos de Amazon. Solo te pregunta lo que no puede completar.' },
  { key: 'safety', label: 'Seguridad y conformidad', explanation: 'Una mención o un símbolo no acredita por sí solo la conformidad del producto.' },
  { key: 'production', label: 'Diseño y producción', explanation: 'Parámetros de diseño, medidas nominales y recursos de producción. No se trasladan automáticamente a la ficha comercial.' },
  { key: 'reference', label: 'Referencias externas', explanation: 'Información de ejemplo o de otros productos. Se conserva como referencia y no se atribuye a este producto.' },
];
const supportLabels = { supported: 'Respaldado por el texto de la fuente', needs_review: 'Respaldo por revisar', unsupported: 'Sin respaldo suficiente' };
const claimLabels: Record<string, string> = {
  declared: 'Dato declarado', nominal: 'Dato de diseño, sin medición física', certified_claim: 'Declaración de conformidad por comprobar',
  visual_observation: 'Observación visual, por confirmar', user_declared: 'Dato aportado por ti',
};
export function groupMaterialFacts(facts: MaterialFact[]) {
  const groups = new Map<string, MaterialFact[]>();
  for (const fact of facts) {
    const key = [fact.canonicalField || fact.field, fact.scope, fact.claimType].join(':');
    const group = groups.get(key) ?? [];
    group.push(fact); groups.set(key, group);
  }
  return [...groups.values()];
}
function Evidence({ items, sources }: { items: MaterialEvidence[]; sources: Map<string, MaterialSource> }) {
  return <>{items.map((evidence, index) => <div className="drive-fact-evidence" key={evidence.citationId ?? `${evidence.sourceId}:${index}`}>
    <strong><MaterialSourceName source={sources.get(evidence.sourceId)} />{customerLocation(evidence.locator) && <> · {customerLocation(evidence.locator)}</>}</strong>
    <q>{evidence.excerpt}</q>
    <MaterialEvidenceLocation evidence={evidence} />
    {!!evidence.contextEvidence?.length && <details><summary>Contexto del dato · {evidence.contextEvidence.length}</summary>
      <p>Etiqueta, unidad y estado del mismo registro de origen.</p>
      <ul>{evidence.contextEvidence.map((context, contextIndex) => <li key={context.citationId ?? `${context.sourceId}:${contextIndex}`}>
        <strong><MaterialSourceName source={sources.get(context.sourceId)} />{customerLocation(context.locator) && <> · {customerLocation(context.locator)}</>}</strong>
        <q>{context.excerpt}</q>
      </li>)}</ul>
    </details>}
  </div>)}</>;
}
function FactValue({ fact, sources }: { fact: MaterialFact; sources: Map<string, MaterialSource> }) {
  const declaredByUser = fact.status === 'confirmed' && fact.confirmationOrigin === 'user_declared';
  const changedValue = fact.status === 'confirmed' && fact.confirmedValue && fact.confirmedValue !== fact.value;
  const asset = fact.scope.startsWith('asset:') ? [...sources.values()].find(source => fact.scope === `asset:${source.id}` || fact.scope.startsWith(`asset:${source.id}:`)) : undefined;
  const scopeLabel = fact.scope.startsWith('asset:') ? `Recurso: ${asset?.name || 'Recurso de origen'}`
    : fact.scope.startsWith('variant:') ? `Variante: ${fact.scope.slice(8)}` : '';
  return <div className="drive-fact-value">
    <p><strong>{fact.status === 'confirmed' ? fact.confirmedValue ?? fact.value : fact.value}</strong>
      <span className={`drive-fact-support drive-fact-support--${declaredByUser ? 'needs_review' : fact.supportStatus}`}>{declaredByUser ? 'Declarado por ti al revisar; no acreditado por la fuente' : supportLabels[fact.supportStatus]}</span></p>
    <p className="drive-fact-meta">{fact.confirmationOrigin === 'existing_product' ? 'Coincide con un dato ya confirmado en la ficha' : fact.status === 'confirmed' ? 'Confirmado por ti' : fact.status === 'rejected' ? 'Descartado por ti' : 'Sin confirmar'} · {claimLabels[fact.claimType] ?? 'Afirmación por revisar'}{scopeLabel ? ` · ${scopeLabel}` : ''}</p>
    {changedValue && <p className="drive-fact-meta">Propuesta original: {fact.value}. Las evidencias siguientes corresponden a esa propuesta.</p>}
    {!!fact.supportReasons?.length && <ul className="drive-fact-reasons">{fact.supportReasons.map((reason, index) => <li key={`${reason.code}:${index}`}>{reason.message}</li>)}</ul>}
    {fact.originalValues?.length > 1 && <details><summary>Valores originales unificados · {fact.originalValues.length}</summary><ul>{fact.originalValues.map((value, index) => <li key={index}>{value}</li>)}</ul></details>}
    <Evidence items={fact.evidence} sources={sources} />
  </div>;
}
function FactChannel({ channel, facts, sources }: { channel: typeof channels[number]; facts: MaterialFact[]; sources: Map<string, MaterialSource> }) {
  const [page, setPage] = useState(0);
  const groups = groupMaterialFacts(facts);
  const current = Math.min(page, Math.max(0, Math.ceil(groups.length / PAGE_SIZE) - 1));
  if (!groups.length) return null;
  return <details className="drive-fact-channel"><summary>{channel.label} · {groups.length}</summary>
    <InformationDisclosure label={`Sobre ${channel.label.toLowerCase()}`}><p>{channel.explanation}</p></InformationDisclosure>
    <div>{groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(group => {
      const conflict = group.some(fact => fact.conflict) || group.length > 1;
      return <section className="drive-fact-group" key={group[0].id} aria-label={group[0].label}>
        <h4>{customerText(group[0].label)}</h4>
        {conflict && <p className="drive-fact-conflict">Las fuentes muestran valores distintos. Uony los contrastará y te preguntará solo si necesita tu respuesta para completar Amazon.</p>}
        {group.map(fact => <FactValue key={fact.id} fact={fact} sources={sources} />)}
      </section>;
    })}</div>
    <MaterialPagination page={current} total={groups.length} label={`Páginas de ${channel.label.toLowerCase()}`} onChange={setPage} />
  </details>;
}
function Rejections({ job, sources }: { job: MaterialAnalysisJob; sources: Map<string, MaterialSource> }) {
  const [page, setPage] = useState(0);
  const items = job.facts?.rejections ?? [];
  const historical = job.facts?.historicalRejectionsWithoutCandidate ?? 0;
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
  if (!items.length && !historical) return null;
  return <details className="drive-fact-rejections"><summary>Registro de propuestas no incorporadas · {items.length}</summary>
    <p>Cada observación conserva su motivo. Si se ha encontrado una cita válida en la misma fuente, se indica como recuperada.</p>
    {!!historical && <p>El análisis anterior registró {historical} descartes sin detalle. Conservamos ese registro; la verificación actual muestra sus propios motivos.</p>}
    {job.resolution && <InformationDisclosure><p>Este registro conserva las observaciones de los documentos. Uony solo te preguntará lo que necesite para completar los requisitos de Amazon.</p></InformationDisclosure>}
    <ul>{items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(item => <li key={item.id}>
      <strong>{item.label || 'Propuesta sin formato válido'}{item.value ? `: ${item.value}` : ''}</strong>
      {item.recovered && <p className="drive-fact-meta">Recuperado: se ha localizado otra cita que respalda el dato.</p>}
      {item.reason && <p>{item.reason}</p>}
      {item.reasons?.map((reason, index) => <p key={`${reason.code}:${index}`}>{reason.message}</p>)}
      {!!item.evidence?.length && <Evidence items={item.evidence} sources={sources} />}
    </li>)}</ul>
    <MaterialPagination page={current} total={items.length} label="Páginas de datos no incorporados" onChange={setPage} />
  </details>;
}
export function MaterialCanonicalFacts({ job }: { job: MaterialAnalysisJob }) {
  const sources = new Map(job.sources.map(source => [source.id, source]));
  if (!job.facts) return null;
  return <div className="drive-canonical-facts">
    {channels.map(channel => <FactChannel key={channel.key} channel={channel} facts={job.facts!.proposals.filter(item => item.channel === channel.key)} sources={sources} />)}
    <Rejections job={job} sources={sources} />
  </div>;
}
