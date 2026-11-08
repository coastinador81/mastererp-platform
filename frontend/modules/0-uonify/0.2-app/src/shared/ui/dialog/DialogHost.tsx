import { useSyncExternalStore } from 'react';
import { DialogFrame } from './DialogFrame';
import { getDialogs, subscribeDialogs, type DialogEntry } from './dialogStore';

/** Pinta los diálogos abiertos con `dialog.open` / `dialog.confirm`. Uno en AppProviders. */
export function DialogHost() {
  const entries = useSyncExternalStore(subscribeDialogs, getDialogs, getDialogs);
  return (
    <>
      {entries.map(entry => <HostedDialog key={entry.id} entry={entry} />)}
    </>
  );
}

function HostedDialog({ entry }: { entry: DialogEntry }) {
  const { options, controls, opener } = entry;
  const body = typeof options.body === 'function' ? options.body(controls) : options.body;
  return (
    <DialogFrame
      title={options.title}
      description={options.description}
      actions={options.actions}
      size={options.size}
      className={options.className}
      dismissible={options.dismissible}
      opener={opener}
      controls={controls}
      onRequestClose={controls.close}
    >
      {body}
    </DialogFrame>
  );
}
