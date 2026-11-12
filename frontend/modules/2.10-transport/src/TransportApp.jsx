import React, {useEffect, useMemo, useState} from 'react';
import {config, useWorkspace} from '../../../app-shell/src/session.jsx';
import ApplicationShell from '../../../shared/ui/ApplicationShell.jsx';
import Drivers from '../2.10.1-drivers/src/Drivers.jsx';
import Routes from '../2.10.5-routes/src/Routes.jsx';
import DriverRoute from './DriverRoute.jsx';
import TransportNavigation from './TransportNavigation.jsx';

const valid = new Set(['my-route', 'drivers', 'routes']);
const current = () => {
  const value = location.hash.replace(/^#\/?/, '').split('/')[0];
  return valid.has(value) ? value : 'my-route';
};

export default function TransportApp() {
  const workspace = useWorkspace(), [route, setRoute] = useState(current);

  useEffect(() => {
    const change = () => setRoute(current());
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);

  const permissions = workspace.context?.permissions || [];
  const runtime = useMemo(() => ({
    api: config.adminApiUrl,
    tenant: workspace.tenant,
    company: workspace.company,
    permissions,
    request: workspace.request,
  }), [workspace.tenant, workspace.company, permissions, workspace.request]);

  const navigate = value => { location.hash = `/${value}`; };
  let content;

  if (!workspace.signedIn) content = <section className="transport-welcome"><p className="eyebrow">REPARTIDORES</p><h1>Gestiona rutas y entregas.</h1><p>Accede con tu cuenta Uonify para continuar.</p><button className="primary" disabled={workspace.authenticating} onClick={workspace.startLogin}>Acceder</button></section>;
  else if (workspace.loading) content = <p role="status">Preparando tu espacio de trabajo…</p>;
  else if (!workspace.tenant || !workspace.company) content = <div className="notice">Selecciona un espacio y una empresa para continuar.</div>;
  else if (!workspace.context?.modules.includes('erp.transport')) content = <div className="notice error">Repartidores no está habilitado para este espacio.</div>;
  else if (route === 'my-route' && permissions.includes('transport.deliveries.execute')) content = <DriverRoute runtime={runtime} />;
  else if (route === 'drivers' && permissions.includes('transport.drivers.read')) content = <Drivers runtime={runtime} />;
  else if (route === 'routes' && permissions.includes('operations.routes.read')) content = <Routes runtime={runtime} />;
  else content = <div className="notice error">No tienes permiso para consultar esta capacidad.</div>;

  return (
    <ApplicationShell
      workspace={workspace}
      currentApp="transport"
      brand="Repartidores"
      brandHref="#/my-route"
      contextLabel={route}
      contextKey={[workspace.signedIn, workspace.tenant, workspace.company].join(':')}
      className="transport-app"
      navigation={<TransportNavigation permissions={permissions} route={route} navigate={navigate} />}
      environmentLabel="Uonify Transporte · Entorno de desarrollo"
      error={workspace.error}
    >
      {content}
    </ApplicationShell>
  );
}
