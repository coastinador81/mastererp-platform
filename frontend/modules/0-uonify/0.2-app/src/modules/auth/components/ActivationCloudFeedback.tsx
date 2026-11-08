import { useEffect, useRef } from 'react';
import type { SetupOperation } from '../model/activation';

interface Props {
  operation: SetupOperation | null;
  busy: boolean;
  checking: boolean;
  repeated: boolean;
  resultVersion: number;
  error: string;
  diagnosing?: boolean;
}

/** El resultado HTTP y el resultado de Google son estados diferentes. */
export function ActivationCloudFeedback({ operation, busy, checking, repeated, resultVersion, error, diagnosing = false }: Props) {
  const alert = useRef<HTMLDivElement>(null);
  const pending = busy || operation?.status === 'preparing';
  useEffect(() => {
    if (!pending && (resultVersion > 0 || error)) alert.current?.focus();
  }, [resultVersion, error, pending]);
  if (pending) return <div className="cld-feedback" role="status" aria-live="polite" aria-atomic="true">
    <strong>{diagnosing ? 'Revisando la conexión con Google…' : operation?.accessCheck?.status === 'waiting' ? 'Esperando a que Google confirme el acceso al modelo…' : checking ? 'Comprobando la IA con Google…' : 'Preparando tu IA con Google…'}</strong>
    <p>{diagnosing ? 'Revisamos el acceso sin generar contenido ni repetir la prueba de IA.' : operation?.accessCheck?.status === 'waiting' ? operation.accessCheck.message : checking ? 'Esperamos el resultado de esta comprobación. No necesitas volver a enviarla.' : operation?.message || 'Tu solicitud está en curso. Conservaremos el mismo intento hasta conocer su resultado.'}</p>
  </div>;
  if (error) return <div ref={alert} className="cld-feedback" role="alert" tabIndex={-1}>
    <strong>No hemos podido recibir el resultado.</strong>
    <p>{error}</p><p>Tu solicitud sigue guardada. Al continuar consultaremos el mismo intento, sin crear otra prueba.</p>
  </div>;
  if (!operation) return null;
  if (operation.accessCheck && operation.modelTest !== 'passed') return <div ref={alert} className="cld-feedback" role={operation.accessCheck.status === 'eligible' ? 'status' : 'alert'} tabIndex={-1}>
    <strong>{operation.accessCheck.status === 'eligible' ? 'El acceso al modelo ya responde.' : 'La conexión con el modelo necesita revisión.'}</strong><p>{operation.accessCheck.message}</p>
  </div>;
  const message = operation.recovery?.message || operation.errorDetails?.message || operation.message;
  if (operation.modelTest === 'failed') return <div ref={alert} className="cld-feedback" role="alert" tabIndex={-1}>
    <strong>{repeated ? 'Google ha vuelto a rechazar la comprobación de IA.' : 'Google ha rechazado la comprobación de IA.'}</strong><p>{message}</p>
  </div>;
  if (operation.status === 'unknown' || operation.modelTest === 'unknown') return <div ref={alert} className="cld-feedback" role="alert" tabIndex={-1}>
    <strong>No hemos podido confirmar el resultado de la comprobación.</strong><p>{message}</p><p>No repetiremos automáticamente la prueba anterior.</p>
  </div>;
  if (operation.status === 'action_required') return <div ref={alert} className="cld-feedback" role="alert" tabIndex={-1}>
    <strong>La preparación necesita tu atención.</strong><p>{message}</p>
  </div>;
  if (operation.status === 'ready' && operation.modelTest === 'passed') return <div className="cld-feedback" role="status"><strong>Tu IA está preparada</strong><p>{message}</p></div>;
  return null;
}
