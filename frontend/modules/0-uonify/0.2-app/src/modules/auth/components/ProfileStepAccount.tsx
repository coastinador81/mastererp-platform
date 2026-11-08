import { useAuthSession } from '../hooks/useSession';
import { lockedEmailHelp } from '../model/onboarding';
import { AGE_OPTIONS } from '../model/options';
import { EMAIL_MAX_LENGTH } from '../model/profile';
import { useAuthUi } from '../state/authUi';
import { FieldShell, SelectInput, TextInput } from './ProfileFields';

/** Paso 1 · Tú: nombre, apellidos, correo (el de la cuenta) y franja de edad (18+). */
export function ProfileStepAccount({ hidden, part }: { hidden: boolean; part?: 'identity' | 'age' }) {
  const emailLocked = useAuthUi(state => state.profile.emailLocked);
  const underage = useAuthUi(state => state.profile.values.ageRange === 'under18');
  const { provider } = useAuthSession();
  return (
    <section className="uon-onboard-step" data-onboard-step="0" hidden={hidden}>
      <h2 id="uon-profile-title">Empecemos por ti</h2>
      <p id="uon-profile-intro" className="uon-onboard-intro">
        {part ? part === 'identity' ? '¿Cómo quieres que nos dirijamos a ti?' : 'Confirma que tienes 18 años o más.' : 'Solo te pedimos lo necesario para crear tu espacio Uonify y dirigirnos a ti.'}
      </p>
      <div className="uon-onboard-grid">
        {part !== 'age' && <><FieldShell id="uon-profile-first-name" label="Nombre">
          <TextInput id="uon-profile-first-name" name="firstName" autoComplete="given-name" maxLength={60} placeholder="Tu nombre" required stepFocus />
        </FieldShell>
        <FieldShell id="uon-profile-last-name" label="Apellidos">
          <TextInput id="uon-profile-last-name" name="lastName" autoComplete="family-name" maxLength={90} placeholder="Tus apellidos" required />
        </FieldShell>
        {(!part || !emailLocked) && <FieldShell id="uon-profile-email" label="Correo electrónico" wide>
          <TextInput
            id="uon-profile-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={EMAIL_MAX_LENGTH}
            placeholder="nombre@empresa.com"
            required
            readOnly={emailLocked}
            describedBy="uon-profile-email-help"
          />
          <small id="uon-profile-email-help">{emailLocked ? lockedEmailHelp(provider) : 'Es el correo con el que entrarás en Uonify.'}</small>
        </FieldShell>}</>}
        {part !== 'identity' && <FieldShell id="uon-profile-age" label="Franja de edad" wide>
          <SelectInput id="uon-profile-age" name="ageRange" options={AGE_OPTIONS} required describedBy="uon-profile-age-help" />
          <small id="uon-profile-age-help">Uonify es para uso profesional y solo para personas de 18 años o más.</small>
          <p className="uon-age-notice" id="uon-age-notice" role="alert" hidden={!underage}>
            Si eres menor de 18 años, no puedes crear un espacio en Uonify.
          </p>
        </FieldShell>}
      </div>
      {part === 'identity' && emailLocked && <p className="activation-verified-email">Usamos tu correo de Google verificado.</p>}
    </section>
  );
}
