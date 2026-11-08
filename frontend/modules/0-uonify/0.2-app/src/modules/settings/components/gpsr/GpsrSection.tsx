import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, dialog, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { deleteBrand, putBrand } from '../../api/settingsApi';
import { settingsKeys } from '../../api/endpoints';
import { useBrands } from '../../hooks/queries';
import { emptyBrandProfile, isBrandProfileComplete, type BrandGpsrProfile, type StoredBrandProfile } from '../../model/brandGpsrProfile';
import { Loading, LoadError, SettingsCard, SettingRow } from '../common';
import { BrandGpsrEditor } from './BrandGpsrEditor';
import '../../styles/index.css';

/**
 * Configuración → «GPSR por marca» (perfil de marca BrandGpsrProfile, /api/brands).
 * Lista de marcas con su fabricante y, si lo hay, su persona responsable en la UE
 * (condicional: null cuando el fabricante está en la UE — se trata sin romper). Editar
 * y crear usan el editor alineado BrandGpsrEditor (dirección estructurada, correo
 * obligatorio, responsable condicional). Guarda con PUT /api/brands/{marca}.
 */
export function GpsrSection() {
  const query = useBrands();
  const client = useQueryClient();
  const [editing, setEditing] = useState<StoredBrandProfile | 'new' | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: settingsKeys.brands }); };
  const remove = useMutation({ mutationFn: deleteBrand, onSuccess: refresh, onError: e => toast.error(errorMessage(e)) });
  if (query.isPending) return <Loading />;
  if (!query.data) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsCard title="Datos de seguridad por marca" description="Guarda el fabricante y la persona responsable en la UE para los productos de cada marca."
    actions={<Button variant="primary" onClick={() => setEditing('new')}>Añadir marca</Button>}>
    {!query.data.length ? <p>Añade tu primera marca para guardar sus datos GPSR.</p> : null}
    {query.data.map(brand => <SettingRow key={brand.id} title={brand.brand}
      description={brand.euResponsible ? `${brand.manufacturer.name} · ${brand.euResponsible.name}` : brand.manufacturer.name}
      actions={<><Button onClick={() => setEditing(brand)}>Editar</Button><Button disabled={remove.isPending} onClick={async () => {
        if (await dialog.confirm({ title: 'Eliminar marca', description: `Se eliminarán los datos GPSR guardados de ${brand.brand}.`, confirmLabel: 'Eliminar' })) remove.mutate(brand.brand);
      }}>Eliminar</Button></>} />)}
    {editing ? <BrandEditor key={editing === 'new' ? 'new' : editing.id} brand={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
  </SettingsCard>;
}

function stripMeta(brand: StoredBrandProfile): BrandGpsrProfile {
  return { brand: brand.brand, manufacturer: brand.manufacturer, euResponsible: brand.euResponsible, autoApply: brand.autoApply };
}

function BrandEditor({ brand, onClose, onSaved }: { brand?: StoredBrandProfile; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<BrandGpsrProfile>(() => brand ? stripMeta(brand) : emptyBrandProfile());
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: () => putBrand(draft.brand.trim(), { ...draft, ...(brand ? { revision: brand.revision } : {}) }),
    onSuccess: () => { onSaved(); onClose(); toast.success('Datos GPSR guardados'); },
    onError: e => setProblem(errorMessage(e)),
  });
  const submit = () => { if (!isBrandProfileComplete(draft)) { setProblem('Revisa los datos marcados antes de guardar.'); return; } setProblem(''); save.mutate(); };
  return <Dialog open title={brand ? 'Editar marca' : 'Añadir marca'} onClose={onClose}
    footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Guardar</Button></>}>
    <BrandGpsrEditor value={draft} onChange={setDraft} />
    {problem ? <p role="alert" className="settings-form-error">{problem}</p> : null}
  </Dialog>;
}
