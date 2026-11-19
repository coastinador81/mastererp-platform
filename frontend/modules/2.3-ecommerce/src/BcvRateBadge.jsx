import React, {useEffect, useRef, useState} from 'react';
import {formatBcvRate, millisecondsUntilNextBcvRefresh} from './bcv-rate.mjs';

const storedRate = tenant => {
  if (!tenant) return null;
  try { return JSON.parse(sessionStorage.getItem(`mastererp.bcv-rate:${tenant}`)); }
  catch { return null; }
};

export default function BcvRateBadge({runtime, enabled = true}) {
  const [rate, setRate] = useState(() => storedRate(runtime.tenant));
  const request = useRef(runtime.request);
  request.current = runtime.request;

  useEffect(() => {
    if (!enabled || !runtime.tenant) {
      setRate(null);
      return undefined;
    }
    let active = true;
    let timer;
    const load = async () => {
      try {
        const next=await request.current(`${runtime.api}/v1/exchange-rates/current`,{headers:{'X-Tenant-Id':runtime.tenant}});
        if (active) {
          setRate(next);
          sessionStorage.setItem(`mastererp.bcv-rate:${runtime.tenant}`, JSON.stringify(next));
        }
      } catch { /* Keep the last persisted rate during a transient request failure. */ }
      if (active) timer = window.setTimeout(load, millisecondsUntilNextBcvRefresh());
    };
    void load();
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled,runtime.api,runtime.tenant]);

  if (!enabled) return null;
  if (!rate) return <span className="bcv-rate-badge is-unavailable" title="Tasa BCV no disponible">BCV --</span>;
  const formatted = formatBcvRate(rate.rate);
  return (
    <span className="bcv-rate-badge" title={rate.effectiveDate ? `Fecha valor: ${rate.effectiveDate}` : 'Tasa BCV'}>
      <small>BCV</small><strong>{formatted} Bs/USD</strong>
    </span>
  );
}
