import clsx from 'clsx';
import { ChatGPTPlanExplanation } from './ChatGPTPlanExplanation';
import { Badge } from '@/shared/ui';
import { useAuthSession } from '../hooks/useSession';
import { CHATGPT_PLAN_CONSENT, formatConsentDate } from '../model/legal';
import { chatgptStepIntro, type ChatGPTChoice } from '../model/onboarding';
import { patchProfile, useAuthUi } from '../state/authUi';

/**
 * Paso 4 · «Conecta tu plan de ChatGPT»: permiso aparte del inicio de sesión
 * (requisito de OpenAI), versionado y opcional. Explica que Uony usará el plan del
 * cliente, que ese uso cuenta para sus límites y que puede desconectarlo cuando
 * quiera. Sin él, Uony usa tokens de Uonify, que necesitan un plan.
 */
export function ProfileStepChatGPT({ hidden }: { hidden: boolean }) {
  const { provider, chatgptPlan } = useAuthSession();
  const { chatgptChoice, chatgptConsent } = useAuthUi(state => state.profile);
  const connected = chatgptPlan.status === 'connected';

  return (
    <section className="uon-onboard-step" data-onboard-step="3" hidden={hidden}>
      <h2 id="uon-profile-chatgpt-title" tabIndex={-1} data-step-focus={connected || undefined}>
        Conecta tu plan de ChatGPT
      </h2>
      <p id="uon-profile-chatgpt-intro" className="uon-onboard-intro">
        {chatgptStepIntro(provider)}
      </p>
      <ChatGPTPlanExplanation />
      {connected ? (
        <p className="uon-chatgpt-connected" role="status">
          <Badge tone="green" icon="check">
            Conectado
          </Badge>
          <span>
            Plan de ChatGPT conectado{chatgptPlan.email ? ` · ${chatgptPlan.email}` : ''}
            {chatgptPlan.connectedAt ? ` · ${formatConsentDate(chatgptPlan.connectedAt)}` : ''}
          </span>
          
        </p>
      ) : (
        <ChoiceGroup provider={provider} choice={chatgptChoice} consent={chatgptConsent} />
      )}
    </section>
  );
}

interface ChoiceGroupProps {
  provider: string | null;
  choice: ChatGPTChoice;
  consent: boolean;
}

function ChoiceGroup({ provider, choice, consent }: ChoiceGroupProps) {
  const choose = (next: ChatGPTChoice) => patchProfile({ chatgptChoice: next, status: '' });
  const recommended = provider === 'chatgpt' ? 'Recomendado' : 'Recomendado · IA sin coste añadido';
  return (
    <div className="uon-chatgpt-choice" role="radiogroup" aria-labelledby="uon-chatgpt-choice-label">
      <p id="uon-chatgpt-choice-label" className="uon-chatgpt-choice-label">
        ¿Quieres que Uony use tu plan de ChatGPT?
      </p>
      <label className={clsx('uon-choice-card', choice === 'connect' && 'is-selected')}>
        <input type="radio" name="chatgptChoice" value="connect" required checked={choice === 'connect'} data-step-focus onChange={() => choose('connect')} />
        <span className="uon-choice-title">
          Conectar mi plan de ChatGPT <Badge tone="ai">{recommended}</Badge> 
        </span>
        <span className="uon-choice-copy">Uony trabaja con tu plan de ChatGPT, dentro de sus límites.</span>
      </label>
      {choice === 'connect' ? (
        <div className="uon-terms-check uon-chatgpt-consent">
          <input
            id="uon-chatgpt-consent"
            type="checkbox"
            name="chatgptConsent"
            required
            checked={consent}
            onChange={event => patchProfile({ chatgptConsent: event.target.checked, status: '' })}
          />
          <label htmlFor="uon-chatgpt-consent">{CHATGPT_PLAN_CONSENT}</label>
        </div>
      ) : null}
      <label className={clsx('uon-choice-card', choice === 'skip' && 'is-selected')}>
        <input type="radio" name="chatgptChoice" value="skip" required checked={choice === 'skip'} onChange={() => choose('skip')} />
        <span className="uon-choice-title">Ahora no</span>
        <span className="uon-choice-copy">
          Uony usará tokens de Uonify, que necesitan un plan de pago. Podrás conectarlo más tarde en Configuración › Conexiones.
        </span>
      </label>
    </div>
  );
}
