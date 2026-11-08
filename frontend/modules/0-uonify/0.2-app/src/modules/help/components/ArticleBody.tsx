import { createElement } from 'react';
import { parseMarkdown, type Inline } from '../model/markdown';
function inline(parts: Inline[]) { return parts.map((part, i) => part.kind === 'link' ? <a key={i} href={part.href} rel={part.external ? 'noreferrer' : undefined}>{part.text}</a> : part.kind === 'strong' ? <strong key={i}>{part.text}</strong> : part.kind === 'code' ? <code key={i}>{part.text}</code> : part.text); }
export function ArticleBody({ body }: { body: string }) {
  return <div className="hlp-article-body">{parseMarkdown(body).map((block, i) => {
    if ('text' in block) return createElement(block.kind, { key: i, id: block.id }, block.text);
    if ('items' in block) return createElement(block.kind, { key: i }, block.items.map((item, j) => <li key={j}>{inline(item)}</li>));
    return createElement(block.kind === 'note' ? 'blockquote' : 'p', { key: i }, inline(block.content));
  })}</div>;
}
