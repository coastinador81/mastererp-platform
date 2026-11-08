import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Counter, Dialog, Field, Textarea, type IconName } from '@/shared/ui';
import { REASON_MAX, reasonError } from '../../model/validation';

/**
 * Confirmación con motivo obligatorio: toda acción sensible del equipo explica por qué
 * y el motivo queda en la auditoría. `children` añade campos propios (importe, tipo…);
 * `validate` devuelve un error de esos campos o null.
 */
export interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmIcon?: IconName;
  destructive?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  children?: ReactNode;
  validate?: () => string | null;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

export function ReasonDialog(props: ReasonDialogProps) {
  if (!props.open) return null;
  return <ReasonDialogBody {...props} />;
}

function ReasonDialogBody({
  title,
  description,
  confirmLabel,
  confirmIcon,
  destructive = false,
  reasonLabel = 'Motivo',
  reasonHint = 'Obligatorio. Lo verá el resto del equipo en la auditoría.',
  children,
  validate,
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const formId = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const reasonProblem = touched ? reasonError(reason) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const fieldProblem = validate?.() ?? null;
    if (reasonError(reason) || fieldProblem) { setFailure(fieldProblem); return; }
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => (busy ? undefined : onClose())}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant={destructive ? 'danger' : 'primary'} icon={confirmIcon} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form" onSubmit={event => void submit(event)} noValidate>
        {children}
        <Field
          label={reasonLabel}
          labelAside={<Counter value={reason.trim().length} max={REASON_MAX} />}
          hint={reasonHint}
          error={reasonProblem ?? undefined}
        >
          <Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} onBlur={() => setTouched(true)} data-autofocus={children ? undefined : true} />
        </Field>
        {failure ? (
          <Alert tone="red" role="alert">
            {failure}
          </Alert>
        ) : null}
      </form>
    </Dialog>
  );
}
