import { useTabContext } from '@/shared/pim';

/** Campo numérico del borrador (precio, coste, stock): escribe en `edited` con ctx.edit. */
export function NumberField({ uid, name, label, value, placeholder }: {
  uid: string;
  name: string;
  label: string;
  value: string | number;
  placeholder: string;
}) {
  const ctx = useTabContext();
  const id = `${uid}-${name}`;
  return (
    <div className="pim-field">
      <label className="pim-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="pim-input"
        type="number"
        inputMode="decimal"
        data-draft={name}
        value={value}
        placeholder={placeholder}
        onChange={event => ctx.edit({ [name]: event.target.value })}
      />
    </div>
  );
}
