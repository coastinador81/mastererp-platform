import { useCallback, useEffect, useId, type RefObject } from 'react';
import { useTabContext } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { locked as isLocked } from '../../model/project';
import { effectiveFormat } from '../../model/studio';
import type { Shot, VideoView } from '../../model/types';
import { refreshBalance } from '../../jobs/balance';
import { useBalance, useBusy, useGenerating, useRetryingShots } from '../../hooks/useJobs';
import { useStudioActions } from '../../hooks/useStudioActions';
import { useVideoStudio, type LibraryApi } from '../../hooks/useVideoData';
import type { ProductView } from '../../hooks/useProductData';
import { DestinationSection } from './DestinationSection';
import { JobPanel } from './JobPanel';
import { OutputSection } from './OutputSection';
import { PlanSection } from './PlanSection';
import { StudioFooter } from './StudioFooter';

/**
 * «Crear con Uony» (prototipo: studioHTML): destino, formato y audio, guion por
 * planos con cierre de marca, vídeo en curso y «Generar vídeo» con el saldo.
 * Mientras un vídeo se genera, la configuración queda bloqueada.
 */
interface StudioViewProps {
  root: RefObject<HTMLElement | null>;
  library: LibraryApi;
  productView: ProductView;
  textHintId: string;
  setView: (view: VideoView) => void;
}

export function StudioView({ root, library, productView, textHintId, setView }: StudioViewProps) {
  const { key } = useTabContext();
  const base = useId();
  const ids = { dest: `${base}-dest`, output: `${base}-output`, format: `${base}-format`, audio: `${base}-audio`, job: `${base}-job` };
  const studio = useVideoStudio(productView);
  const { state, resolved, patchShot, patchPlan } = studio;
  const actions = useStudioActions({ root, studio, library, productView, setView });
  const balance = useBalance();
  const proposing = useBusy(key, tag => tag === 'propose');
  const sending = useBusy(key, tag => tag === 'generate');
  const generating = useGenerating(key);
  const retryingShot = useRetryingShots(key);
  const locked = isLocked(state);

  // El saldo se consulta al abrir el estudio (como mucho una vez por minuto).
  useEffect(() => { void refreshBalance(); }, []);

  const onShot = useCallback((shotId: string, patch: Partial<Shot>) => {
    if (!locked) patchShot(state.destination, shotId, patch);
  }, [locked, patchShot, state.destination]);
  const onTagline = useCallback((tagline: string) => {
    if (!locked) patchPlan(state.destination, plan => ({ ...plan, closing: { ...(plan.closing || {}), tagline } }));
  }, [locked, patchPlan, state.destination]);

  return (
    <div className="pim-video-studio">
      <div className="pim-video-studio-intro">
        <h3 className="pim-video-studio-title">Crear vídeo con Uony<span className="pim-ai-mark"><Icon name="sparkles" size={12} />Veo 3.1</span></h3>
        <p>Uonify prepara el guion con los datos de la ficha y la IA genera cada plano a partir de tus fotos.</p>
      </div>
      <div data-region="job">
        {state.project ? (
          <JobPanel
            project={state.project}
            destination={state.destination}
            headingId={ids.job}
            onOpenResult={actions.openResult}
            onDownload={actions.downloadResult}
            onDismiss={actions.dismissProject}
            onGoTo={actions.goToDestination}
          />
        ) : null}
      </div>
      <fieldset className="pim-video-fieldset" disabled={locked}>
        <legend className="pim-sr-only">Configuración del vídeo</legend>
        <DestinationSection headingId={ids.dest} value={state.destination} onChange={destination => actions.setStudio({ destination })} />
        <OutputSection
          ids={ids}
          destination={state.destination}
          format={effectiveFormat(state)}
          audio={state.audio}
          onFormat={format => actions.setStudio({ format })}
          onAudio={audio => actions.setStudio({ audio })}
        />
        <PlanSection
          state={state}
          plan={resolved}
          brand={String(productView.product.brand || '')}
          textHintId={textHintId}
          proposing={proposing}
          sending={sending}
          retryingShot={retryingShot}
          onPropose={() => void actions.proposePlan()}
          onPick={actions.pickImage}
          onShot={onShot}
          onTagline={onTagline}
          onRetry={shotId => void actions.retryShot(shotId)}
        />
      </fieldset>
      <StudioFooter balance={balance} locked={locked} sending={sending} generating={generating} onGenerate={() => void actions.generate()} />
    </div>
  );
}
