import React, {useEffect, useRef, useState} from 'react';
import {login, logout, completeLogin, loadSpaces} from '../../../shared/auth/cognito.mjs';
import config from '../auth-config.json';

export default function IdentityAccess() {
  const [signedIn, setSignedIn] = useState(false);
  const [spaces, setSpaces] = useState(null);
  const [tenant, setTenant] = useState('');
  const [message, setMessage] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (window.location.pathname !== '/auth/callback' || started.current) return;
    started.current = true;
    (async () => {
      try {
        await completeLogin(config);
        setSignedIn(true);
        const assigned = await loadSpaces(config);
        setSpaces(assigned);
        if (assigned.length === 1) setTenant(assigned[0].id);
      } catch (error) { setMessage(error.message); }
    })();
  }, []);
  const changeTenant = event => {
    // No conversation/data caches are enabled. Discard the previous context.
    setTenant('');
    setMessage('');
    setTenant(event.target.value);
  };
  const startLogin = async () => {
    setTenant(''); setSpaces(null); setMessage('');
    try { await login(config); } catch { setMessage('No se pudo iniciar el acceso.'); }
  };
  return <div className="identity-access">
    {!signedIn ? <button type="button" onClick={startLogin}>Acceder</button> : <>
      {spaces?.length === 0 && <span>Todavía no tienes un espacio asignado.</span>}
      {spaces?.length === 1 && <span>Espacio: {spaces[0].name}</span>}
      {spaces && spaces.length > 1 && <label>Espacio <select value={tenant} onChange={changeTenant}>
        <option value="">Selecciona tu espacio</option>
        {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select></label>}
      <button type="button" onClick={() => {setTenant(''); setSpaces(null); setMessage(''); logout(config);}}>Salir</button>
    </>}
    {message && <span role="status">{message}</span>}
  </div>;
}
