import { Button, Dialog } from '@/shared/ui';
import { usePanelStore, currentRoute, openHelp, closePanel, back, navigate } from '../hooks/panelStore';
import { useArticles, useArticle, useHelpSearch } from '../hooks/helpQueries';
import { useState } from 'react';
import { Field, Input } from '@/shared/ui';
import { ArticleBody } from './ArticleBody';
import { SupportChat } from './SupportChat';
import { TicketList, TicketForm, TicketDetail } from './SupportTickets';
import { BookingView } from './BookingView';
import './help.css';
export function HelpButton() {
  const state = usePanelStore(); const route = currentRoute(state);
  return <><Button size="sm" onClick={() => openHelp()}>Ayuda</Button><Dialog open={state.open} title="Ayuda de Uonify" onClose={closePanel} size="md" className="hlp-sheet">
    <div className="hlp-panel-body">{state.stack.length > 1 ? <Button onClick={back}>Volver</Button> : null}
      {route.view === 'home' ? <HelpHome /> : route.view === 'article' ? <PanelArticle slug={route.slug} /> : route.view === 'chat' ? <SupportChat /> : route.view === 'tickets' ? <TicketList /> : route.view === 'new-ticket' ? <TicketForm prefill={route.prefill} /> : route.view === 'ticket' ? <TicketDetail id={route.id} /> : <BookingView />}
    </div>
  </Dialog></>;
}
function HelpHome() {
  const [q, setQ] = useState(''); const articles = useArticles({}); const results = useHelpSearch(q);
  const list = q.trim().length >= 2 ? results.data?.results : articles.data;
  return <><Field label="Buscar ayuda"><Input type="search" value={q} onChange={e => setQ(e.target.value)} /></Field>
    {articles.error || results.error ? <p role="alert">No se ha podido cargar la ayuda. <Button onClick={() => { void articles.refetch(); void results.refetch(); }}>Reintentar</Button></p> : null}
    <ul>{list?.slice(0, 8).map(a => <li key={a.slug}><button type="button" className="pim-link" onClick={() => navigate({ view: 'article', slug: a.slug })}>{a.title}</button></li>)}</ul>
    <Button variant="primary" icon="uony" onClick={() => navigate({ view: 'chat' })}>Hablar con Uony</Button>
    <Button onClick={() => navigate({ view: 'tickets' })}>Mis tickets</Button><Button onClick={() => navigate({ view: 'booking' })}>Reservar videollamada</Button><a href="/ayuda">Abrir centro de ayuda</a>
  </>;
}
function PanelArticle({ slug }: { slug: string }) {
  const query = useArticle(slug);
  return query.data ? <article><h2>{query.data.title}</h2><p>{query.data.summary}</p><ArticleBody body={query.data.body} /></article> : <p role={query.error ? 'alert' : 'status'}>{query.error ? 'No se ha podido cargar el artículo.' : 'Cargando artículo…'}</p>;
}
