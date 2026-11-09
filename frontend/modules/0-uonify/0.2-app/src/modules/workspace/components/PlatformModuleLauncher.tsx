import '../../../../../../../shared/module-launcher/module-launcher.mjs';

type Props = { currentApp?: string };

/** Menú de nueve puntos compartido con Finanzas, Ecommerce y Centro de Agentes. */
export function PlatformModuleLauncher({ currentApp = 'uonify' }: Props) {
  return <mastererp-module-launcher current-app={currentApp} />;
}
