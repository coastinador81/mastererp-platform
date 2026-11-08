import type { FieldMap } from './types';
import { own } from './translations';

/**
 * «Conexiones API Externas» (APIConnectionModal del original). Es una simulación:
 * Uonify todavía no se conecta con estas plataformas, las credenciales no salen del
 * navegador ni se guardan y la búsqueda devuelve datos de ejemplo.
 */

export interface CredentialField {
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  placeholder: string;
  required: boolean;
}

export interface ApiConnection {
  id: string;
  name: string;
  type: 'sheets' | 'office' | 'cms' | 'ecommerce';
  icon: string;
  description: string;
  fields: Record<string, CredentialField>;
}

export const API_CONNECTIONS: ApiConnection[] = [
  {
    id: 'google-sheets', name: 'Google Sheets', type: 'sheets', icon: '📊',
    description: 'Conectar con hojas de cálculo de Google Sheets',
    fields: {
      spreadsheetId: { label: 'ID de Hoja de Cálculo', type: 'text', placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', required: true },
      apiKey: { label: 'API Key de Google', type: 'password', placeholder: 'AIzaSyC...', required: true },
      range: { label: 'Rango de Celdas', type: 'text', placeholder: 'A1:Z1000', required: false },
    },
  },
  {
    id: 'microsoft-365', name: 'Microsoft 365', type: 'office', icon: '🔷',
    description: 'Conectar con Excel Online y SharePoint',
    fields: {
      tenantId: { label: 'Tenant ID', type: 'text', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
      clientId: { label: 'Client ID', type: 'text', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
      clientSecret: { label: 'Client Secret', type: 'password', placeholder: 'Valor secreto...', required: true },
      workbookId: { label: 'ID del Libro de Trabajo', type: 'text', placeholder: '{workbook-id}', required: true },
    },
  },
  {
    id: 'wordpress', name: 'WordPress', type: 'cms', icon: '📝',
    description: 'WooCommerce y WordPress con API REST',
    fields: {
      siteUrl: { label: 'URL del Sitio', type: 'url', placeholder: 'https://tutienda.com', required: true },
      consumerKey: { label: 'Consumer Key', type: 'text', placeholder: 'ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', required: true },
      consumerSecret: { label: 'Consumer Secret', type: 'password', placeholder: 'cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', required: true },
    },
  },
  {
    id: 'prestashop', name: 'PrestaShop', type: 'ecommerce', icon: '🛒',
    description: 'API Web Service de PrestaShop',
    fields: {
      shopUrl: { label: 'URL de la Tienda', type: 'url', placeholder: 'https://tutienda.com', required: true },
      apiKey: { label: 'Web Service Key', type: 'password', placeholder: 'API Key de PrestaShop...', required: true },
    },
  },
  {
    id: 'magento', name: 'Magento', type: 'ecommerce', icon: '🔶',
    description: 'Magento REST API v2',
    fields: {
      baseUrl: { label: 'URL Base', type: 'url', placeholder: 'https://tutienda.com', required: true },
      adminToken: { label: 'Admin Token', type: 'password', placeholder: 'Bearer token...', required: true },
    },
  },
  {
    id: 'shopify', name: 'Shopify', type: 'ecommerce', icon: '🛍️',
    description: 'Shopify Admin API',
    fields: {
      shopDomain: { label: 'Dominio de la Tienda', type: 'text', placeholder: 'tu-tienda.myshopify.com', required: true },
      accessToken: { label: 'Access Token', type: 'password', placeholder: 'shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', required: true },
      apiVersion: { label: 'Versión de API', type: 'text', placeholder: '2023-10', required: false },
    },
  },
];

export type ConnectionStatus = 'idle' | 'connecting' | 'success' | 'error';

/** Espera de la conexión y de la búsqueda simuladas (las del original). */
export const SIMULATED_CONNECT_MS = 2000;
export const SIMULATED_SEARCH_MS = 1500;

/** Etiquetas de los campos requeridos vacíos (E30: etiquetas, no claves internas). */
export function missingRequiredCredentials(connection: ApiConnection, credentials: Record<string, string>): string[] {
  return Object.entries(connection.fields)
    .filter(([field, config]) => config.required && !credentials[field]?.trim())
    .map(([, config]) => config.label);
}

/**
 * Comprobación local de la simulación (la del original): alguna credencial con más
 * de 10 caracteres. No valida nada contra la plataforma.
 */
export const credentialsLookComplete = (credentials: Record<string, string>): boolean =>
  Object.values(credentials).some(value => value.length > 10);

export type ExampleProduct = Record<string, string | number> & { sku: string; name: string; source: string };

/** Resultados de ejemplo por tipo de plataforma (generateMockResults del original). */
export function exampleResults(connection: ApiConnection, sku: string): ExampleProduct[] {
  const base = { sku, name: `Producto ${sku}`, source: connection.name };
  switch (connection.type) {
    case 'sheets':
      return [{ ...base, peso: '2.8 kg', dimensiones: '45 x 30 x 25 cm', 'garantía': '24 meses', certificaciones: 'CE, RoHS', color: 'Negro', materiales: 'Aluminio, Plástico ABS' }];
    case 'ecommerce':
      return [{ ...base, precio: '299.99', stock: 45, categoria: 'Electrónicos', marca: 'TechBrand', descripcion: 'Producto de alta calidad con tecnología avanzada', peso: '3.1 kg', dimensiones: '50 x 35 x 28 cm' }];
    default:
      return [{ ...base, peso: '2.5 kg', dimensiones: '48 x 32 x 26 cm', 'garantía': '12 meses' }];
  }
}

/** Filas de detalle de un resultado (sin sku, nombre ni fuente). */
export const resultDetails = (product: ExampleProduct): Array<[string, string]> =>
  Object.entries(product).filter(([key]) => !['sku', 'name', 'source'].includes(key)).map(([key, value]) => [key, String(value)]);

/** selectProductData: los campos faltantes que trae el resultado, más los habituales de ficha técnica. */
export function relevantProductData(product: ExampleProduct, missingFields: string[]): FieldMap {
  const relevant: FieldMap = {};
  const source = product as Record<string, unknown>;
  missingFields.forEach(field => { if (own(source, field)) relevant[field] = source[field]; });
  ['peso', 'dimensiones', 'garantía', 'certificaciones', 'materiales'].forEach(field => {
    if (own(source, field) && !relevant[field]) relevant[field] = source[field];
  });
  return relevant;
}
