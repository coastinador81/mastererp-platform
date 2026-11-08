import { useState } from 'react';
import { Link } from 'react-router';
import { Field, Input } from '@/shared/ui';
import { useArticles } from '../../hooks/useExternal';
import { PageHeader, QueryState } from '../common/PageParts';
export function ArticlesPage() {
  const query = useArticles(); const [q, setQ] = useState('');
  return <div className="adm-page"><PageHeader title="Artículos de ayuda" actions={<Link to="/admin/articulos/nuevo">Crear artículo</Link>} /><Field label="Buscar artículos"><Input value={q} onChange={e => setQ(e.target.value)} /></Field><QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()}><ul className="adm-timeline">{query.data?.filter(a => `${a.title} ${a.summary}`.toLocaleLowerCase('es').includes(q.toLocaleLowerCase('es'))).map(article => <li key={article.id}><Link to={`/admin/articulos/${article.id}`}>{article.title}</Link><p>{article.summary}</p><small>{article.status === 'published' ? 'Publicado' : 'Borrador'}</small></li>)}</ul></QueryState></div>;
}
