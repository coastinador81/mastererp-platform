import { getChannel, publishWith, registerChannel } from '@/shared/pim';
import { amazonChecks } from '../model/amazonChecks';

/**
 * Canal «Amazon» del diálogo «Publicar» (prototipo: pim/publicar.js). Los
 * marketplaces que lleguen se registran igual con registerChannel(), sin tocar el
 * diálogo. El envío es el publicador «Amazon» que registra Atributos (el mismo que
 * «Guardar Cambios» con el canal activo: POST /amazon/listings).
 */
export const AMAZON_CHANNEL = {
  id: 'Amazon',
  label: 'Amazon',
  market: 'Amazon.es · Seller Central',
  logo: '/assets/brands/amazon-logo.svg',
} as const;

/** Registra el canal una sola vez (al importar el módulo). */
export function registerAmazonChannel(): void {
  if (getChannel(AMAZON_CHANNEL.id)) return;
  registerChannel(AMAZON_CHANNEL.id, {
    label: AMAZON_CHANNEL.label,
    market: AMAZON_CHANNEL.market,
    logo: AMAZON_CHANNEL.logo,
    // La conexión de la cuenta se hace en Nexus; hasta entonces, sin conectar.
    connected: () => false,
    checks: amazonChecks,
    publish: data => publishWith(AMAZON_CHANNEL.id, data, AMAZON_CHANNEL.label),
  });
}
