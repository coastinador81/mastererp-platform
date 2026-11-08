/**
 * Vía B de Amazon (GPSR, §8 de producto-catalogo-ESPEC-gpsr-20261023.md): el
 * alta en «Manage Your Compliance» de Seller Central, que confirma el vendedor
 * con una casilla. CONDICIONAL por Brand Registry (con BR → a nivel de marca; sin
 * BR → por SKU) y POR CADA TIENDA UE: se guarda un registro por tienda. Diseño:
 * UNA casilla por tienda (la más honesta). Textos legales EXACTOS de Legal (no
 * reescribir); el texto DEBE nombrar la(s) tienda(s) vía el marcador {tiendas}.
 */
export interface StoreCompliance { confirmed: boolean; at?: string; by?: string }
/** Mapa por tienda de Amazon UE: ISO2 de la tienda → confirmación. */
export type AmazonCompliance = Record<string, StoreCompliance>;

export interface AmazonStore { iso2: string; name: string }
/** Tiendas de Amazon en la UE (ISO2 → nombre de dominio). */
export const AMAZON_EU_STORES: ReadonlyArray<AmazonStore> = [
  { iso2: 'ES', name: 'amazon.es' },
  { iso2: 'DE', name: 'amazon.de' },
  { iso2: 'FR', name: 'amazon.fr' },
  { iso2: 'IT', name: 'amazon.it' },
  { iso2: 'NL', name: 'amazon.nl' },
  { iso2: 'SE', name: 'amazon.se' },
  { iso2: 'PL', name: 'amazon.pl' },
  { iso2: 'BE', name: 'amazon.com.be' },
];
export function storeName(iso2: string): string {
  return AMAZON_EU_STORES.find(store => store.iso2 === iso2)?.name ?? iso2;
}

/** Textos legales EXACTOS (§8, Legal; NO reescribir). {tiendas}/{stores} = nombres de tienda. */
export const VIA_B_BRAND_ES = 'Esta marca está inscrita en el Registro de Marcas de Amazon (Brand Registry). He dado de alta en Seller Central de Amazon, para {tiendas}, al fabricante de esta marca y a su persona responsable en la UE, con su nombre, su dirección postal y su correo. Los correos son los mismos que he puesto en Uonify.';
export const VIA_B_BRAND_EN = "This brand is enrolled in Amazon Brand Registry. In Amazon Seller Central, for {stores}, I have registered this brand's manufacturer and its EU responsible person, with their name, postal address and email. The email addresses are the same as the ones I entered in Uonify.";
export const VIA_B_PRODUCT_ES = 'He dado de alta en Seller Central de Amazon, para {tiendas}, al fabricante de este producto y a su persona responsable en la UE, con su nombre, su dirección postal y su correo. Los correos son los mismos que he puesto en Uonify.';
export const VIA_B_PRODUCT_EN = "In Amazon Seller Central, for {stores}, I have registered this product's manufacturer and its EU responsible person, with their name, postal address and email. The email addresses are the same as the ones I entered in Uonify.";

/** Une nombres de tienda en lenguaje natural ES: «amazon.es», o «amazon.es y amazon.de». */
export function joinStores(storeNames: string[]): string {
  if (storeNames.length <= 1) return storeNames[0] ?? '';
  return `${storeNames.slice(0, -1).join(', ')} y ${storeNames[storeNames.length - 1]}`;
}

/** Sustituye {tiendas}/{stores} por los nombres de tienda. */
export function renderViaB(template: string, storeNames: string[]): string {
  const list = joinStores(storeNames);
  return template.replace('{tiendas}', list).replace('{stores}', list);
}

/** Tiendas que faltan por confirmar de una lista de tiendas objetivo. */
export function unconfirmedStores(stores: string[], value: AmazonCompliance): string[] {
  return stores.filter(iso2 => !value[iso2]?.confirmed);
}
