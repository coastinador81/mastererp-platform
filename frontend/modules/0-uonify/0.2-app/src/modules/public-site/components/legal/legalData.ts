/**
 * Datos de la empresa para los textos legales de la web pública.
 * Espejo de `platform/docs/legal/DATOS-EMPRESA.md` (la fuente la mantiene el hilo Legal).
 * Única fuente de los valores: se cambian aquí y se vuelcan en todos los textos legales.
 * No se inventa ningún dato; los que están pendientes se marcan abajo.
 */
const VALUES: Record<string, string> = {
  LLC_NOMBRE: 'ETHICS CLOUD & SECURITY SERVICES LLC',
  LLC_ESTADO: 'Florida',
  LLC_REGISTRO:
    'L26000467601, en el registro de sociedades del Estado de Florida (Division of Corporations), desde el 4 de septiembre de 2026',
  LLC_DOMICILIO: '4572 NW 114th Ave 1301, Doral, Florida 33178, EE. UU.',
  // Solo se publica en el Aviso legal (lo exige el art. 10.1.f de la LSSI y ya aparece en las facturas).
  LLC_FISCAL: 'EIN (número de identificación fiscal federal de EE. UU.): 42-5010954',
  FIRMANTE: 'Edward Gonzalez, miembro autorizado (Authorized Member) de ETHICS CLOUD & SECURITY SERVICES LLC',
  TELEFONO: '+34 676 520 899',
  EMAIL_SOPORTE: 'hola@uonify.com',
  EMAIL_LEGAL: 'legal@uonify.com',
  EMAIL_PRIVACIDAD: 'privacidad@uonify.com',
  EMAIL_COPYRIGHT: 'copyright@uonify.com',
  EMAIL_SEGURIDAD: 'security@uonify.com',
  CONTACTO_PRIVACIDAD: 'Edward Gonzalez, responsable de privacidad de ETHICS CLOUD & SECURITY SERVICES LLC',
  // Representante RGPD en la UE y en el Reino Unido: DataRep (ya contratado).
  // Texto final de Legal (08-11-2026), con el domicilio social de DataRep y sus canales.
  REPRESENTANTE_UE:
    'DataRep (Data Protection Representative Limited), con domicilio social en 77 Camden Street Lower, Dublín D02 XE80, Irlanda. Para dirigirte al representante, usa el formulario de https://www.datarep.com/data-request/ o escribe a datarequest@datarep.com, indicando que tu solicitud es para ETHICS CLOUD & SECURITY SERVICES LLC (Uonify)',
  REPRESENTANTE_UK:
    'DataRep UK, la sociedad del grupo DataRep en el Reino Unido, por esos mismos canales',
  LEY_APLICABLE: 'Florida (EE. UU.)',
  REGION_DATOS: 'Irlanda (Unión Europea)',
  // Pendiente de confirmar por el dueño (DATOS-EMPRESA: «a confirmar»; dev.uonify.com es el de pruebas).
  DOMINIO: 'uonify.com',
  // ÚNICO sitio de la fecha de vigor. Provisional: el dueño/CEO fija la fecha real
  // justo antes de publicar (se cambia solo aquí).
  FECHA_VIGOR: '9 de noviembre de 2026',
};

/** Sustituye las marcas {{CLAVE}} de un texto legal por su valor final.
 *  Colapsa el doble punto que surge cuando un valor acaba en punto (p. ej. «EE. UU.»)
 *  y la plantilla añade otro: «EE. UU.. Puedes» → «EE. UU. Puedes». */
export function fillLegal(raw: string): string {
  return raw
    .replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => (key in VALUES ? VALUES[key] : match))
    .replace(/\.\.(\s|$)/g, '.$1');
}
