import React, {useEffect, useState} from 'react';
import {
  emptyFinanceConfig,
  loadFinanceConfig,
  normalizeExchangeRate,
  normalizeTaxRate,
  saveFinanceConfig,
} from '../../../shared/finance-tax-config.mjs';

export default function FinanceConfiguration({workspace}) {
  const [draft, setDraft] = useState(emptyFinanceConfig);
  const [bcvUsd, setBcvUsd] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const canWrite = workspace.context?.permissions?.includes('administration.read');
  const baseCurrency = 'VES';

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadFinanceConfig(workspace).then(config => {
      if (!active) return;
      setDraft(config);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [workspace.tenant, workspace.company]);

  useEffect(() => {
    let active = true;
    if (!workspace.request || !workspace.tenant) {
      setBcvUsd(null);
      return undefined;
    }
    workspace.request(`${workspace.api}/v1/exchange-rates/current`, {headers: {'X-Tenant-Id': workspace.tenant}})
      .then(rate => {
        if (!active || rate?.base !== 'USD' || rate?.quote !== 'VES') return;
        const value = Number(rate?.rate);
        if (Number.isFinite(value) && value > 0) setBcvUsd({rate: value, effectiveDate: rate.effectiveDate, source: rate.source});
      })
      .catch(() => { if (active) setBcvUsd(null); });
    return () => { active = false; };
  }, [workspace.api, workspace.request, workspace.tenant]);

  async function submit(event) {
    event.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveFinanceConfig(workspace, draft);
      setDraft(saved);
      setNotice('Configuración guardada. El catálogo y las operaciones pueden consultar IVA y tipos de cambio.');
    } catch {
      setError('No se pudo guardar la configuración.');
    } finally {
      setBusy(false);
    }
  }

  function applyBcvUsd() {
    if (!bcvUsd?.rate) return;
    setDraft(current => ({...current, usd_exchange_rate: bcvUsd.rate}));
  }

  const percentField = (key, label, hint) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        disabled={!canWrite || busy}
        value={draft[key] ?? ''}
        onChange={event => setDraft(current => ({...current, [key]: event.target.value === '' ? '' : Number(event.target.value)}))}
        onBlur={() => setDraft(current => ({...current, [key]: normalizeTaxRate(current[key])}))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );

  const rateField = (key, label, hint) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min="0"
        step="0.000001"
        disabled={!canWrite || busy}
        value={draft[key] ?? ''}
        onChange={event => setDraft(current => ({...current, [key]: event.target.value === '' ? '' : Number(event.target.value)}))}
        onBlur={() => setDraft(current => ({...current, [key]: normalizeExchangeRate(current[key])}))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );

  if (loading) return <p className="notice" role="status">Cargando configuración…</p>;

  return <section className="finance-configuration">
    <p className="eyebrow">Finanzas</p>
    <h1>Configuración</h1>
    <p>Parámetros generales de impuestos y divisas. Otras áreas del ERP los consultan al registrar precios o convertir montos.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <form className="finance-configuration-stack" onSubmit={submit}>
      <section className="panel finance-configuration-form">
        <h2>IVA</h2>
        <p>Porcentajes que se proponen al crear o editar productos cuando no tienen un IVA propio.</p>
        <div className="finance-configuration-fields">
          {percentField('sale_tax_rate', 'IVA de venta (%)', 'Impuesto sobre el precio de venta.')}
          {percentField('cost_tax_rate', 'IVA de costo (%)', 'Impuesto asociado al costo de adquisición.')}
        </div>
      </section>
      <section className="panel finance-configuration-form">
        <h2>Tipo de cambio</h2>
        <p>Valor de referencia por 1 unidad de moneda extranjera, expresado en {baseCurrency}.</p>
        {bcvUsd && <p className="finance-configuration-reference">
          Referencia BCV (USD): <strong>{bcvUsd.rate}</strong>
          {bcvUsd.effectiveDate ? ` · ${bcvUsd.effectiveDate}` : ''}
          {canWrite && <button type="button" className="secondary" disabled={busy} onClick={applyBcvUsd}>Usar en dólar</button>}
        </p>}
        <div className="finance-configuration-fields">
          {rateField('usd_exchange_rate', `Dólar (USD) → ${baseCurrency}`, `Cuántos ${baseCurrency} equivalen a 1 USD.`)}
          {rateField('eur_exchange_rate', `Euro (EUR) → ${baseCurrency}`, `Cuántos ${baseCurrency} equivalen a 1 EUR.`)}
        </div>
      </section>
      {canWrite && <button className="cat-primary finance-configuration-save" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar configuración'}</button>}
    </form>
  </section>;
}