import { GOAL_OPTIONS, ROLE_OPTIONS, SIZE_OPTIONS, SOURCE_OPTIONS } from '../model/options';
import { FieldShell, Optional, SelectInput, TextInput } from './ProfileFields';
import { InformationDisclosure } from '@/shared/ui';

/** Paso 2 · Tu trabajo: actividad, equipo, empresa, objetivo y origen. */
export function ProfileStepWork({ hidden, part }: { hidden: boolean; part?: 'activity' | 'goal' }) {
  const company = <FieldShell id="uon-profile-company" label={<>Empresa <Optional /></>} wide>
    <TextInput id="uon-profile-company" name="company" autoComplete="organization" maxLength={100} placeholder="Nombre de tu empresa" />
  </FieldShell>;
  const goal = <FieldShell id="uon-profile-goal" label="¿Qué quieres hacer primero?">
    <SelectInput id="uon-profile-goal" name="primaryGoal" options={GOAL_OPTIONS} required />
  </FieldShell>;
  const source = <FieldShell id="uon-profile-source" label={<>¿Cómo nos conociste? <Optional /></>}>
    <SelectInput id="uon-profile-source" name="source" options={SOURCE_OPTIONS} describedBy="uon-profile-source-help" />
    <small id="uon-profile-source-help">Solo para nuestras estadísticas.</small>
  </FieldShell>;
  return (
    <section className="uon-onboard-step" data-onboard-step="1" hidden={hidden}>
      <h2 id="uon-profile-work-title">Conozcamos tu trabajo</h2>
      <p id="uon-profile-work-intro" className="uon-onboard-intro">
        {part ? part === 'activity' ? 'Cuéntanos a qué te dedicas.' : 'Elige por dónde quieres empezar.' : 'Con estas respuestas adaptamos tu punto de partida en Uonify. Podrás cambiarlas más adelante.'}
      </p>
      <div className="uon-onboard-grid">
        {part !== 'goal' && <><FieldShell id="uon-profile-role" label="Tu actividad">
          <SelectInput id="uon-profile-role" name="role" options={ROLE_OPTIONS} required stepFocus />
        </FieldShell>
        <FieldShell id="uon-profile-size" label="Tamaño del equipo">
          <SelectInput id="uon-profile-size" name="companySize" options={SIZE_OPTIONS} required />
        </FieldShell></>}
        {part !== 'activity' && (part === 'goal' ? <>{goal}<InformationDisclosure className="activation-optional-fields" label="Datos opcionales">{company}{source}</InformationDisclosure></> : <>{company}{goal}{source}</>)}
      </div>
    </section>
  );
}
