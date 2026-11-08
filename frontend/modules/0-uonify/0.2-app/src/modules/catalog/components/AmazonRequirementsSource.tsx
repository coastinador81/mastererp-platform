import { useId, useState } from 'react';
import { InformationDisclosure } from '@/shared/ui';
import type { AmazonRequirements, AmazonRequirementsSource as Source } from '../api/amazonRequirements';

const MARKETS = [
  ['A1RKKUPIHCS9HS', 'España'], ['A13V1IB3VIYZZH', 'Francia'], ['A1PA6795UKMFR9', 'Alemania'],
  ['APJ6JRA9NG5V4', 'Italia'], ['A1805IZSGTT6HS', 'Países Bajos'], ['AMEN7PMS3EDWL', 'Bélgica'],
  ['A2NODRKZP88ZB9', 'Suecia'], ['A1C3SOZRARQ6R3', 'Polonia'], ['A28R8C7NBKEWEA', 'Irlanda'], ['A1F83G8C2ARO7P', 'Reino Unido'],
];
interface Props { evaluation: AmazonRequirements['evaluation']; revision: number; disabled: boolean; saving: boolean; onSave: (source: Source) => Promise<unknown> }
export function AmazonRequirementsSource({ evaluation, revision, disabled, saving, onSave }: Props) {
  const id = useId();
  const [mode, setMode] = useState<'asin' | 'type'>(evaluation.referenceAsin || !evaluation.productType ? 'asin' : 'type');
  const [asin, setAsin] = useState(evaluation.referenceAsin ?? '');
  const [productType, setProductType] = useState(evaluation.productType ?? '');
  const [market, setMarket] = useState(evaluation.marketplaceId);
  const [error, setError] = useState('');
  return <details className="amazon-requirements-source" open={evaluation.state === 'unconfigured' || evaluation.state === 'stale' ? true : undefined}>
    <summary>{evaluation.productType ? 'Cambiar categoría o actualizar requisitos de Amazon' : 'Elegir la categoría de Amazon'}</summary>
    <p>Indica el código de un producto similar en Amazon o elige su tipo de producto para consultar los datos que necesita.</p>
    <InformationDisclosure><p>Consultar los requisitos no publica el producto.</p></InformationDisclosure>
    <form aria-label="Configurar requisitos de Amazon" onSubmit={event => {
      event.preventDefault(); if (disabled) return;
      const input = (mode === 'asin' ? asin : productType).trim().toUpperCase();
      if (mode === 'asin' ? !/^[A-Z0-9]{10}$/.test(input) : !/^[A-Z][A-Z0-9_]{0,99}$/.test(input)) { setError(mode === 'asin' ? 'El ASIN debe tener 10 letras o números, por ejemplo B07NPPMZM8.' : 'Introduce el tipo de producto de Amazon, por ejemplo TABLETOP_GAME.'); return; }
      setError(''); void onSave({ revision, marketplaceId: market, ...(mode === 'asin' ? { referenceAsin: input } : { productType: input }) });
    }} noValidate>
      <fieldset disabled={disabled}><legend className="sr-only">Fuente de los requisitos</legend><div className="product-preparation-fields">
        <label htmlFor={`${id}-market`}><span>País de venta en Amazon</span><select id={`${id}-market`} value={market} onChange={event => setMarket(event.target.value)}>{MARKETS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label htmlFor={`${id}-mode`}><span>Cómo identificar la categoría</span><select id={`${id}-mode`} value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError(''); }}><option value="asin">ASIN de un producto similar</option><option value="type">Tipo de producto de Amazon</option></select></label>
        {mode === 'asin' ? <label htmlFor={`${id}-asin`}><span>ASIN de referencia</span><input id={`${id}-asin`} value={asin} maxLength={10} onChange={event => setAsin(event.target.value)} autoCapitalize="characters" placeholder="B07NPPMZM8" /></label>
          : <label htmlFor={`${id}-type`}><span>Tipo de producto de Amazon</span><input id={`${id}-type`} value={productType} maxLength={100} onChange={event => setProductType(event.target.value)} autoCapitalize="characters" placeholder="TABLETOP_GAME" /></label>}
      </div></fieldset>
      {error && <p role="alert" className="product-preparation-error">{error}</p>}
      <div className="product-preparation-actions"><button type="submit" disabled={disabled}>{saving ? 'Consultando Amazon…' : evaluation.productType ? 'Actualizar requisitos' : 'Consultar requisitos'}</button></div>
    </form>
  </details>;
}
