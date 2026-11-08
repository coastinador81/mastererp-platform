import { ChatGPTPlanExplanation } from './ChatGPTPlanExplanation';
import type { ReactNode } from 'react';
import { useAuthSession } from '../hooks/useSession';
import { CHATGPT_PLAN_CONSENT, AI_CLAUSE_TEXT, AI_CLAUSE_TITLE, CONSENT_DOCUMENTS, currentConsent, formatConsentDate } from '../model/legal';
import type { ConsentRecord } from '../model/types';
import { patchProfile, setTermsCheck, useAuthUi, type TermsChecks } from '../state/authUi';

/**
 * Primer paso · Condiciones: tres casillas sin marcar, cada una por separado y con su
 * versión (requisito F4 de la revisión de OpenAI). La cláusula «Modelos de IA de
 * terceros» es la aprobada por el abogado del dueño y se muestra tal cual.
 */
export function ProfileStepTerms({ hidden, part }: { hidden: boolean; part?: 'general' | 'ai' }) {
  const terms = useAuthUi(state => state.profile.terms);
  const { consents, provider, chatgptPlan } = useAuthSession();
  const consent = useAuthUi(state => state.profile.chatgptConsent);
  return (
    <section className="uon-onboard-step" data-onboard-step="2" hidden={hidden}>
      <h2 id="uon-profile-terms-title">Condiciones de Uonify</h2>
      <p id="uon-profile-terms-intro" className="uon-onboard-intro">
        {part ? part === 'general' ? 'Lee y acepta las condiciones para continuar.' : 'Lee la cláusula de IA antes de aceptarla.' : 'Léelas y marca cada casilla. Guardamos la versión y la fecha de lo que aceptas; puedes volver a consultarlas en este paso.'}
      </p>
      <div className="uon-terms-list">
        {part !== 'ai' && <><TermsCheck id="terms" checked={terms.terms} consents={consents} stepFocus>
          Acepto las{' '}
          <a href="/terminos" target="_blank" rel="noopener">
            Condiciones del servicio
          </a>{' '}
          de Uonify.
        </TermsCheck>
        <TermsCheck id="privacy" checked={terms.privacy} consents={consents}>
          He leído la{' '}
          <a href="/privacidad" target="_blank" rel="noopener">
            Política de privacidad
          </a>
          .
        </TermsCheck></>}
        {part !== 'general' && <><div className="uon-terms-clause" id="uon-terms-clause">
          <strong>{AI_CLAUSE_TITLE}</strong> {AI_CLAUSE_TEXT}
        </div>
        <TermsCheck id="ai-third-party" checked={terms['ai-third-party']} consents={consents} describedBy="uon-terms-clause">
          Acepto la cláusula «Modelos de IA de terceros».
        </TermsCheck></>}
      </div>
      {provider === 'chatgpt' && part !== 'general' ? <div className="uon-inline-plan-permission">
        <p className="uon-onboard-intro">Has iniciado sesión con ChatGPT. Aquí puedes autorizar a Uony a utilizar tu plan, con un permiso separado de las condiciones generales.</p>
        <ChatGPTPlanExplanation />
        {chatgptPlan.status === 'connected' ? <p className="uon-chatgpt-connected" role="status">Ya has autorizado el uso de tu plan de ChatGPT.</p> : <div className="uon-terms-check uon-chatgpt-consent">
          <input id="uon-inline-chatgpt-consent" type="checkbox" checked={consent} aria-describedby="uon-inline-chatgpt-note" onChange={event => patchProfile({ chatgptConsent: event.target.checked, status: '' })} />
          <label htmlFor="uon-inline-chatgpt-consent">{CHATGPT_PLAN_CONSENT}</label>
          <small id="uon-inline-chatgpt-note">Es opcional. Si no lo autorizas, podrás conectarlo más tarde en Configuración. Para usar Uony sin ChatGPT necesitarás un plan de pago y tokens de Uonify.</small>
        </div>}
      </div> : null}
    </section>
  );
}

interface TermsCheckProps {
  id: keyof TermsChecks;
  checked: boolean;
  consents: readonly ConsentRecord[];
  describedBy?: string;
  stepFocus?: boolean;
  children: ReactNode;
}

function TermsCheck({ id, checked, consents, describedBy, stepFocus, children }: TermsCheckProps) {
  const inputId = `uon-terms-${id}`;
  const accepted = currentConsent(consents, id);
  const noteId = `${inputId}-note`;
  return (
    <div className="uon-terms-check">
      <input
        id={inputId}
        type="checkbox"
        name={id}
        required
        checked={checked}
        data-step-focus={stepFocus || undefined}
        aria-describedby={[describedBy, accepted ? noteId : ''].filter(Boolean).join(' ') || undefined}
        onChange={event => setTermsCheck(id, event.target.checked)}
      />
      <label htmlFor={inputId}>{children}</label>
      <small id={noteId} hidden={!accepted}>
        {accepted ? `Aceptado el ${formatConsentDate(accepted.acceptedAt)} · versión ${CONSENT_DOCUMENTS[id].version}` : ''}
      </small>
    </div>
  );
}
