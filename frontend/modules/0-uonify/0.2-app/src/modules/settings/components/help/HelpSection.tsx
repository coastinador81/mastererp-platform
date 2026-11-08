import { Link } from 'react-router';
import { SettingsCard, SettingRow } from '../common';

export function HelpSection() {
  return <SettingsCard title="Estamos para ayudarte">
    <SettingRow title="Centro de ayuda" description="Guías para empezar, conectar tus cuentas y trabajar con Uony." actions={<Link to="/ayuda">Consultar guías</Link>} />
    <SettingRow title="Contacta con Uonify" description="Cuéntanos qué necesitas." actions={<a href="mailto:hola@uonify.com">hola@uonify.com</a>} />
  </SettingsCard>;
}
