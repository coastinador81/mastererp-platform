import { useQuery } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { useOwnedRequest } from '@/shared/hooks';
import { getInstructionDriveJob, type InstructionDriveJob } from '../api/instructionDriveJob';
import { useWorkspaceStore } from '../hooks/workspaceStore';

function stateText(job: InstructionDriveJob): string {
  const folder = job.folderName ? `«${job.folderName}»` : 'la carpeta';
  if (job.status === 'queued') return `Análisis de ${folder} en cola.`;
  if (job.status === 'running') return job.total > 0 && job.processed <= job.total
    ? `Analizando ${folder}: ${job.processed} de ${job.total} archivos revisados.`
    : `Analizando ${folder}.`;
  if (job.status === 'ready') {
    const observations = job.observations.map(item => `${item.source}: ${item.summary}`);
    const additional = job.additionalObservations
      ? ` Hay observaciones de ${job.additionalObservations} archivos más guardadas.` : '';
    return observations.length
      ? `Análisis de ${folder} terminado. Observaciones preliminares: ${observations.join(' · ')}.${additional}`
      : `Análisis de ${folder} terminado. No hay observaciones de archivos disponibles para mostrar.`;
  }
  if (job.status === 'paused') return `Análisis de ${folder} en pausa. El trabajo guardado se conserva.`;
  return `El análisis de ${folder} terminó con una incidencia. El trabajo guardado se conserva.`;
}

/** Muestra el estado persistido de una orden directa, sin ficha ni otro control de autorización. */
export function ConversationDriveJob({ account, threadId, jobId, intakeId }: {
  account: string; threadId: string; jobId: string; intakeId: string | null;
}) {
  const active = useWorkspaceStore(state => state.activeThreadId === threadId && state.historyAccount === account);
  const owner = useOwnedRequest(account, currentAccountEmail);
  const query = useQuery({
    queryKey: ['uony-instruction-drive-job', account, threadId, jobId, intakeId],
    queryFn: ({ signal }) => owner.read(inner => getInstructionDriveJob(jobId, intakeId, inner), signal),
    enabled: active && account === currentAccountEmail(), retry: false,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
    refetchInterval: state => !state.state.error && ['queued', 'running'].includes(state.state.data?.status ?? '') ? 5000 : false,
  });
  if (!active || account !== currentAccountEmail()) return null;
  if (query.isPending) return <p role="status" className="conversation-followup-state-note">Consultando el análisis guardado…</p>;
  if (query.isError) return <>
    <p role="alert" className="conversation-followup-state-note">No se ha podido consultar el estado del análisis.</p>
    <div className="conversation-followup-actions"><button type="button" onClick={() => void query.refetch()}>Volver a consultar</button></div>
  </>;
  return <p role="status" className="conversation-followup-state-note">{stateText(query.data)}</p>;
}
