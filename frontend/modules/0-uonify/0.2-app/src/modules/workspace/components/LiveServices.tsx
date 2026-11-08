import { useState } from 'react';
import { UserRound, CreditCard, Link2, ArrowUpRight, ShieldCheck, ChevronRight, Package } from 'lucide-react';
import { useServiceStatus } from '../hooks/serviceStatus';
import { AccountDeletionControl, currentAccountEmail, useAccountSummary } from '@/modules/auth';
import { OnboardingSubscription } from '@/modules/billing';
import { GpsrSection } from '@/modules/settings';
import { selectService } from '../hooks/actions';
import '../styles/connection-center.css';

type SettingsTab = 'account' | 'subscription' | 'brands';
const SECTION_HEAD: Record<SettingsTab, { title: string; sub: string }> = {
  account: { title: 'Mi cuenta', sub: 'Tu identidad y tu acceso a Uonify.' },
  subscription: { title: 'Tu suscripción', sub: 'Consulta tu plan y gestiona la renovación.' },
  brands: { title: 'GPSR por marca', sub: 'El fabricante y la persona responsable en la UE de cada marca, listos para sus productos.' },
};

/** Cuenta, suscripción y GPSR por marca; las conexiones siguen centralizadas en Nexus. */
export function LiveServices() {
  const account = currentAccountEmail() ?? '';
  const summary = useAccountSummary();
  const state = useServiceStatus();
  // «Completar la marca» (y cualquier enlace a …/configuracion/gpsr) abre directamente GPSR por marca
  // al montar: se llega desde la ficha, que desmonta esta vista, así que leer la URL una vez basta.
  const [tab, setTab] = useState<SettingsTab>(() => (window.location.pathname.endsWith('/gpsr') ? 'brands' : 'account'));
  return <section className="nxs-page settings-page">
    <header className="nxs-header"><div><p className="nxs-eyebrow">TU ESPACIO, A TU MANERA</p><h1>Configuración</h1><p>Lo esencial de tu cuenta, siempre a mano.</p></div></header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Configuración de tu cuenta">
        <button aria-pressed={tab === 'account'} onClick={() => setTab('account')}><UserRound size={18} /> Mi cuenta</button>
        <button aria-pressed={tab === 'subscription'} onClick={() => setTab('subscription')}><CreditCard size={18} /> Suscripción</button>
        <button aria-pressed={tab === 'brands'} onClick={() => setTab('brands')}><Package size={18} /> GPSR por marca</button>
        <span className="settings-nav-separator" />
        <button onClick={() => selectService('nexus')}><Link2 size={18} /> Conexiones <ArrowUpRight size={14} className="settings-nav-arrow" /><span className="sr-only"> en Nexus</span></button>
      </nav>
      <div className="settings-content">
        <header className="settings-section-heading"><h2>{SECTION_HEAD[tab].title}</h2><p>{SECTION_HEAD[tab].sub}</p></header>
        {tab === 'brands' ? <GpsrSection /> : tab === 'subscription' ? <div className="settings-billing"><OnboardingSubscription account={account} /></div> : state.isPending ? <p role="status">Comprobando tu cuenta…</p> : state.isError ? <p role="alert">No podemos comprobar tu cuenta. <button className="nxs-text-button" onClick={() => void state.refetch()}>Reintentar</button></p> : <>
          <div className="settings-profile"><span className="settings-avatar" aria-hidden="true">{summary.initial}</span><div><h3>{summary.name}</h3><p>{state.data.accountEmail}</p></div><span className="nxs-status-label">{summary.planLabel}</span></div>
          <dl className="settings-details">
            <div><dt>Correo electrónico<small>Vinculado a tu cuenta de Google</small></dt><dd>{state.data.accountEmail}</dd></div>
            <div><dt>Inicio de sesión<small>Tu acceso seguro a Uonify</small></dt><dd><ShieldCheck size={16} /> Google</dd></div>
            <div><dt>Suscripción<small>Acceso a las herramientas de Uonify</small></dt><dd><span>{state.data.access.status === 'allowed' ? (state.data.access.basis === 'trial' ? 'Prueba activa' : 'Activa') : 'Sin acceso activo'}</span><button className="nxs-text-button" onClick={() => setTab('subscription')}>Gestionar <ChevronRight size={14} /></button></dd></div>
          </dl>
          <aside className="settings-nexus"><span className="settings-nexus-symbol"><Link2 size={21} /></span><div><h3>Tus herramientas tienen su lugar</h3><p>Conecta tus aplicaciones y canales desde Nexus.</p></div><button aria-label="Ir a Nexus" onClick={() => selectService('nexus')}><ArrowUpRight size={20} /></button></aside>
        </>}
        {tab === 'account' && account && <AccountDeletionControl account={account} />}
      </div>
    </div>
  </section>;
}
