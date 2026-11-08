import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { blenderApi } from '../api/blenderApi';
import { blenderJobPending, type BlenderJob, type BlenderOperation, type BlenderState } from '../model/types';
import { blenderConnectionKey, useBlenderConnection } from './useBlenderConnection';

export function useBlenderProduct(account: string, productId: string) {
  const state = useBlenderConnection(account, true, productId);
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dispatching = useRef(false);
  const request = useRef<{ operation: BlenderOperation; id: string } | null>(null);
  const owned = (job?: BlenderJob | null) => job?.productId === productId ? job : null;
  const initial = owned(state.data?.lastJob);
  const job = useQuery({
    queryKey: ['blender-job', account, productId, initial?.id],
    queryFn: () => blenderApi.job(initial!.id), enabled: !!initial?.id, retry: false, gcTime: 0,
    refetchInterval: query => blenderJobPending(query.state.data?.job ?? initial) ? 2_000 : false,
  });
  const currentJob = owned(job.data?.job) ?? initial;
  const working = blenderJobPending(currentJob);
  const terminal = currentJob && !working ? `${currentJob.id}:${currentJob.status}` : null;
  const preview = currentJob?.status === 'completed' && currentJob.operation === 'render_preview' && currentJob.previewUrl
    ? currentJob : owned(state.data?.lastPreview);
  const connected = state.data?.status === 'connected';
  const access = state.data?.accessAllowed === true;
  useEffect(() => {
    if (terminal) void cache.invalidateQueries({ queryKey: blenderConnectionKey(account, productId) });
  }, [account, productId, cache, terminal]);
  const run = async (operation: BlenderOperation) => {
    const capability = operation === 'inspect' ? 'inspect_scene' : 'render_preview';
    if (!connected || !access || working || dispatching.current || !state.data?.capabilities.includes(capability)) return;
    dispatching.current = true; setBusy(true); setMessage('');
    // Una respuesta perdida se reintenta con el mismo identificador y producto.
    if (request.current?.operation !== operation) request.current = { operation, id: crypto.randomUUID() };
    try {
      const result = await blenderApi.start(operation, request.current.id, productId);
      if (result.job.productId !== productId) throw new Error('La tarea no corresponde a este producto. Actualiza el estado antes de continuar.');
      await cache.cancelQueries({ queryKey: blenderConnectionKey(account, productId) });
      cache.setQueryData<BlenderState>(blenderConnectionKey(account, productId), previous => previous ? { ...previous, lastJob: result.job } : previous);
      request.current = null;
    } catch (error) { setMessage(errorMessage(error)); }
    finally { dispatching.current = false; setBusy(false); }
  };
  const refresh = () => { void state.refetch(); if (initial) void job.refetch(); };
  return { state, job, currentJob, preview, working, connected, access, busy, message, run, refresh };
}
