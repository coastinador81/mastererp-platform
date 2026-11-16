import React, {useEffect, useState} from 'react';
import {BCV_RATE_URL, formatBcvRate, millisecondsUntilNextBcvRefresh, parseBcvRate} from './bcv-rate.mjs';

export default function BcvRateBadge() {
  const [rate, setRate] = useState(null);

  useEffect(() => {
    let active = true;
    let controller;
    let timer;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(BCV_RATE_URL, {
          headers: {Accept: 'application/json'},
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`BCV ${response.status}`);
        const next = parseBcvRate(await response.json());
        if (active) setRate(next);
      } catch (error) {
        if (active && error.name !== 'AbortError') setRate(null);
      }
      if (active) timer = window.setTimeout(load, millisecondsUntilNextBcvRefresh());
    };
    void load();
    return () => { active = false; controller?.abort(); window.clearTimeout(timer); };
  }, []);

  if (!rate) return <span className="bcv-rate-badge is-unavailable" title="Tasa BCV no disponible">BCV --</span>;
  const formatted = formatBcvRate(rate.rate);
  return (
    <span className="bcv-rate-badge" title={rate.effectiveDate ? `Fecha valor: ${rate.effectiveDate}` : 'Tasa BCV'}>
      <small>BCV</small><strong>{formatted} Bs/USD</strong>
    </span>
  );
}
