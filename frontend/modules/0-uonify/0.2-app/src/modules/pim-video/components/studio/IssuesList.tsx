import { useDebouncedValue } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import type { Issue } from '../../model/types';

/**
 * Revisión de textos: lo que Amazon rechaza (error) y consejos (aviso). Región viva
 * que se actualiza al dejar de escribir (300 ms), para no repetir avisos.
 */
export function IssuesList({ issues }: { issues: Issue[] }) {
  const shown = useDebouncedValue(issues, 300);
  return (
    <ul className="pim-video-issues" aria-live="polite">
      {shown.map((issue, index) => (
        <li key={`${issue.field}-${index}-${issue.message}`} className={`is-${issue.level}`}>
          <Icon name={issue.level === 'error' ? 'alert-circle' : 'alert-triangle'} size={14} />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
