/**
 * Módulo pim-gpsr: pestaña «GPSR» de la ficha de producto (prototipo:
 * pim/gpsr.js y pim/gpsr.css). Puerta única del módulo.
 */
import type { PimTabDefinition } from '@/shared/pim';
import { GpsrProductTab } from './components/GpsrProductTab';

export const tab: PimTabDefinition = { key: 'gpsr', label: 'GPSR', icon: 'shield', component: GpsrProductTab };
export const gpsrTab = tab;

export { extractGPSRData, GPSR_DEFAULTS, type GpsrData } from './model/gpsr';
export { EU_COUNTRIES, MULTILINGUAL, isEuCountry, countryName } from './model/gpsrProfile';
export {
  TOY_WARNINGS, TOY_AGE_WARNINGS, RECOMMENDED_AGES, emptyToySafety, toySafetyComplete,
  type ToySafety, type ToyWarning, type ToyAgeWarning,
} from './model/gpsrProfile';
export {
  AMAZON_EU_STORES, VIA_B_BRAND_ES, VIA_B_BRAND_EN, VIA_B_PRODUCT_ES, VIA_B_PRODUCT_EN,
  storeName, renderViaB, joinStores, unconfirmedStores,
  type AmazonCompliance, type StoreCompliance, type AmazonStore,
} from './model/amazonViaB';
export { AmazonComplianceMatrix } from './components/AmazonComplianceMatrix';
export { GpsrEditor, type BrandDefaults } from './components/GpsrEditor';
export type { ProductGpsrData } from './model/gpsrProfile';
