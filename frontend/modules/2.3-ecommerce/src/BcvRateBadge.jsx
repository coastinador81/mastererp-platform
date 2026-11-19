import React, {useEffect, useState} from 'react';
import {formatBcvRate, millisecondsUntilNextBcvRefresh} from './bcv-rate.mjs';

export default function BcvRateBadge({runtime, enabled = true}) {
  const [rate, setRate] = useState(null);

  useEffect(() => {
    if (!enabled || !runtime.tenant) {
      setRate(null);
      return undefined;
    }
    let active = true;
    let timer;
    const load = async () => {
      try {
        const next=await runtime.request(`${runtime.api}/v1/exchange-rates/current`,{headers:{'X-Tenant-Id':runtime.tenant}});
        if (active) setRate(next);
      } catch {
        if (active) setRate(null);
      }
      if (active) timer = window.setTimeout(load, millisecondsUntilNextBcvRefresh());
    };
    void load();
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled,runtime.api,runtime.request,runtime.tenant]);

  if (!enabled) return null;
  if (!rate) return <span className="bcv-rate-badge is-unavailable" title="Tasa BCV no disponible">BCV --</span>;
  const formatted = formatBcvRate(rate.rate);
  return (
    <span className="bcv-rate-badge" title={rate.effectiveDate ? `Fecha valor: ${rate.effectiveDate}` : 'Tasa BCV'}>
      <small>BCV</small><strong>{formatted} Bs/USD</strong>
    </span>
  );
}
