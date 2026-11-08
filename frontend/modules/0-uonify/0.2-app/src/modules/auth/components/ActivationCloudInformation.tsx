import { GoogleAccountRule } from '@/modules/cloud';
import { InformationDisclosure } from '@/shared/ui';

function GoogleCreditOffer() {
  return <p>Los nuevos clientes elegibles de Google Cloud pueden recibir <strong>300 USD durante 90 días</strong> para servicios compatibles. <a href="https://cloud.google.com/free" target="_blank" rel="noopener noreferrer">Ver la promoción oficial de Google ↗</a></p>;
}

export function ActivationCloudInformation({ account, connected }: { account: string; connected: boolean }) {
  return <>
    <InformationDisclosure label="Tu cuenta y el crédito de Google">
      <p className="cld-intro">Uonify coordina tus herramientas y agentes. Google aporta la IA desde tu propia cuenta, bajo sus condiciones.</p>
      <GoogleAccountRule account={account} />
      {connected && <><div className="cld-account-row"><span className="cld-step" aria-hidden="true">✓</span><div><p className="activation-success">Tu cuenta de Google está conectada.</p></div></div><GoogleCreditOffer /></>}
      <p>Crear una cuenta de Gmail o un proyecto no concede el crédito. Google confirma tu elegibilidad, las condiciones y el saldo en su propia página. Esta promoción es independiente de los 14 días de prueba de Uonify; no es un saldo en euros garantizado.</p>
      <p>La prueba exige no haber utilizado antes la promoción ni haber sido cliente de pago de Cloud, Maps o Firebase. Excluye la API de Gemini de AI Studio y los modelos de terceros ofrecidos como servicio. <a href="https://docs.cloud.google.com/free/docs/free-cloud-features" target="_blank" rel="noopener noreferrer">Consultar cobertura y condiciones ↗</a></p>
    </InformationDisclosure>
    {!connected && <GoogleCreditOffer />}
  </>;
}
