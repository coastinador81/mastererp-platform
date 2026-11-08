import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Field, Input, Select, Textarea, dialog, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useArticle, useSaveArticle, useDeleteArticle } from '../../hooks/useExternal';
import { validateArticle } from '../../model/validation';
import type { ArticleDraft, HelpArticle } from '../../model/types';
import { PageHeader, QueryState } from '../common/PageParts';
export function ArticleEditorPage() {
  const { articleId } = useParams(); const isNew = articleId === 'nuevo'; const query = useArticle(isNew ? undefined : articleId);
  return <div className="adm-page"><Link to="/admin/articulos">Volver a artículos</Link><PageHeader title={isNew ? 'Crear artículo' : 'Editar artículo'} />{isNew ? <Editor /> : <QueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>{query.data ? <Editor key={query.data.id} article={query.data} /> : null}</QueryState>}</div>;
}
function Editor({ article }: { article?: HelpArticle }) {
  const [draft, setDraft] = useState<ArticleDraft>(article ?? { title: '', slug: '', summary: '', body: '', collection: 'primeros-pasos', status: 'draft', plan: 'all', keywords: [], assistantNotes: [] });
  const [problem, setProblem] = useState(''); const save = useSaveArticle(); const remove = useDeleteArticle(); const navigate = useNavigate();
  return <form className="adm-form" onSubmit={async e => { e.preventDefault(); const error = Object.values(validateArticle(draft))[0]; if (error) return setProblem(error); try { const saved = await save.mutateAsync({ article, draft }); toast.success('Artículo guardado'); void navigate(`/admin/articulos/${saved.id}`, { replace: true }); } catch (reason) { setProblem(errorMessage(reason)); } }}>
    {(['title', 'slug', 'summary', 'collection'] as const).map(key => <Field key={key} label={{ title: 'Título', slug: 'Dirección del artículo', summary: 'Resumen', collection: 'Colección' }[key]}><Input value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}
    <Field label="Contenido (Markdown)"><Textarea rows={18} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></Field>
    <Field label="Estado"><Select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value === 'published' ? 'published' : 'draft' })}><option value="draft">Borrador</option><option value="published">Publicado</option></Select></Field>
    <Field label="Plan al que se aplica"><Select value={draft.plan} onChange={e => setDraft({ ...draft, plan: e.target.value as ArticleDraft['plan'] })}><option value="all">Todos</option><option value="free">Gratis</option><option value="paid">Planes de pago</option></Select></Field>
    <Field label="Palabras clave, separadas por comas"><Input value={draft.keywords.join(', ')} onChange={e => setDraft({ ...draft, keywords: e.target.value.split(',').map(s => s.trim()) })} /></Field>
    <Field label="Indicaciones internas para Uony (una por línea)"><Textarea value={draft.assistantNotes.join('\n')} onChange={e => setDraft({ ...draft, assistantNotes: e.target.value.split('\n') })} /></Field>
    {problem ? <p role="alert">{problem}</p> : null}<div className="adm-actions-row">{article ? <Button disabled={remove.isPending} onClick={async () => { if (!await dialog.confirm({ title: 'Eliminar artículo', description: 'Dejará de estar disponible en el centro de ayuda.', confirmLabel: 'Eliminar' })) return; try { await remove.mutateAsync(article); void navigate('/admin/articulos'); } catch (e) { setProblem(errorMessage(e)); } }}>Eliminar</Button> : null}<Button type="submit" variant="primary" loading={save.isPending}>Guardar artículo</Button></div>
  </form>;
}
