import { Link } from 'react-router';
import clsx from 'clsx';
import { Alert, buttonClass, Progress } from '@/shared/ui';
import { chatGptPlanLabel } from '../../model/connections';
import { formatPercent } from '../../model/format';
import { settingsPath } from '../../model/sections';
import type { ChatGptConnection } from '../../model/types';
import { usageTone, type UsageBar } from '../../model/usage';
import { LoadError, Loading, SettingsCard } from '../common';

export interface ChatGptLimitsProps {
  connection: ChatGptConnection | undefined;
  bars: UsageBar[];
  plan: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

function limitName(bar: UsageBar): string {
  return bar.id === 'five-hour' ? 'límite de 5 horas' : bar.id === 'weekly' ? 'límite semanal' : bar.label.toLowerCase();
}

/** Aviso al acercarse al límite: qué se ha usado · cuándo se restablece (como Claude). */
function LimitWarning({ bar }: { bar: UsageBar }) {
  const tone = usageTone(bar.usedPercent);
  if (tone === 'normal') return null;
  const reset = bar.resetLabel ? ` · ${bar.resetLabel}` : '';
  if (tone === 'full') {
    return (
      <Alert tone="red" role="status">
        Has alcanzado tu {limitName(bar)} de ChatGPT{reset}. Mientras tanto, puedes seguir con tokens de Uonify si lo eliges.
      </Alert>
    );
  }
  return <Alert tone="amber" role="status">Has usado el {formatPercent(bar.usedPercent)} de tu {limitName(bar)} de ChatGPT{reset}.</Alert>;
}

/** Límites en vivo del plan de ChatGPT: sesión de 5 horas y semana, con su reinicio. */
export function ChatGptLimits({ connection, bars, plan, loading, error, onRetry }: ChatGptLimitsProps) {
  const connected = connection?.status === 'connected';
  const title = 'Límites de tu plan de ChatGPT';

  if (!connected) {
    return (
      <SettingsCard title={title} icon="link" description="Conecta tu cuenta de ChatGPT para que Uony use tu plan. Sin ChatGPT, Uony funciona con tokens de Uonify, que requieren un plan de Uonify.">
        <div className="uset-card-foot">
          <Link to={settingsPath('conexiones')} className={buttonClass('outline', 'sm')}>Ir a Conexiones</Link>
        </div>
      </SettingsCard>
    );
  }

  const worst = [...bars].sort((a, b) => b.usedPercent - a.usedPercent)[0];
  return (
    <SettingsCard
      title={title}
      icon="link"
      description={`${chatGptPlanLabel(connection.plan ?? plan)} · Con ChatGPT conectado, Uony usa tu plan en el chat, las descripciones, las imágenes, la auditoría, el 3D y las automatizaciones.`}
    >
      {loading ? <Loading label="Consultando tus límites…" /> : null}
      {!loading && error ? <LoadError error={error} onRetry={onRetry} title="No se han podido cargar tus límites" /> : null}
      {!loading && !error && !bars.length ? <p className="pim-small pim-muted">Uso no disponible ahora mismo. Lo verás aquí en cuanto ChatGPT lo informe.</p> : null}
      {bars.length ? (
        <ul className="uset-bars" aria-label={title}>
          {bars.map(bar => {
            const tone = usageTone(bar.usedPercent);
            return (
              <li key={bar.id} className="uset-bar">
                <div className="uset-bar-head">
                  <span className="uset-bar-label">{bar.label}</span>
                  <span className="uset-bar-value">{formatPercent(bar.usedPercent)} usado</span>
                </div>
                <Progress value={bar.usedPercent} label={`${bar.label}: ${formatPercent(bar.usedPercent)} usado`} className={clsx('uset-progress', tone !== 'normal' && `is-${tone}`)} />
                {bar.resetLabel ? <span className="uset-bar-reset">{bar.resetLabel}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {worst ? <LimitWarning bar={worst} /> : null}
    </SettingsCard>
  );
}
