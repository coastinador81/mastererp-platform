import {
  AMAZON_COMPLIANCE_DECLARATION, SELLER_DECLARATION, countryName, gateMessage, isEuCountry,
  emptyToySafety, toySafetyComplete, validateProductGpsr, type ProductGpsrData,
} from '../model/gpsrProfile';

const base: ProductGpsrData = {
  brand: 'Basic Mini Bricks', model: 'Set 500', identifierType: 'ean', identifier: '8414600500005',
  toySafety: { warnings: ['choking_hazard_small_parts'], ageWarning: 'not_suitable_under_3_years', language: 'es_ES', ageRangeDescription: '', recommendedAge: '', minAge: '', maxAge: '' },
  hasImage: true,
  saleCountries: ['ES'], warnings: [{ language: 'es_ES', text: 'No apto para menores de 3 años.' }],
  noWarningsNeeded: false, ownLegislationNotice: '', sellerDeclaration: true,
  brandRegistry: 'yes', amazonCompliance: {},
};

describe('países de la UE', () => {
  test('isEuCountry reconoce ISO2 (insensible a mayúsculas) y rechaza lo demás', () => {
    expect(isEuCountry('ES')).toBe(true);
    expect(isEuCountry('fr')).toBe(true);
    expect(isEuCountry('US')).toBe(false);
    expect(isEuCountry(undefined)).toBe(false);
  });
  test('countryName traduce y cae al código si no lo conoce', () => {
    expect(countryName('BE')).toBe('Bélgica');
    expect(countryName('ZZ')).toBe('ZZ');
  });
});

describe('textos legales exactos (no reescribir)', () => {
  test('la declaración del vendedor cita el Reglamento (UE) 2023/988', () => {
    expect(SELLER_DECLARATION.es).toContain('Reglamento (UE) 2023/988');
    expect(SELLER_DECLARATION.en).toContain('Regulation (EU) 2023/988');
  });
  test('la declaración de Amazon menciona Seller Central', () => {
    expect(AMAZON_COMPLIANCE_DECLARATION.es).toContain('Seller Central');
  });
});

describe('gateMessage', () => {
  test('traduce los códigos del backend a mensajes del cliente', () => {
    expect(gateMessage('model')).toMatch(/modelo/i);
    expect(gateMessage('seller_declaration')).toMatch(/declaración/i);
    expect(gateMessage('warnings_FR')).toMatch(/Francia/);
    expect(gateMessage('warnings_review_BE')).toMatch(/Bélgica/);
    expect(gateMessage('warnings_unknown_country_XK')).toMatch(/no reconozco sus lenguas/i);
    expect(gateMessage('brand_eu_responsible_person')).toMatch(/responsable/i);
    expect(gateMessage('amazon_compliance_panel')).toMatch(/Manage Your Compliance/i);
  });
  test('un código desconocido se devuelve tal cual (sin romper la vista)', () => {
    expect(gateMessage('codigo_nuevo')).toBe('codigo_nuevo');
  });
});

describe('toySafetyComplete (Directiva 2009/48/CE)', () => {
  test('una seguridad de juguete vacía no está completa', () => {
    expect(toySafetyComplete(emptyToySafety())).toBe(false);
  });
  test('exige edad mínima y máxima (Amazon las obliga, spec §2.4)', () => {
    const base = { warnings: ['choking_hazard_small_parts' as const], ageWarning: 'not_suitable_under_3_years' as const, language: 'es_ES', ageRangeDescription: '', recommendedAge: '' as const, minAge: '3', maxAge: '12' };
    expect(toySafetyComplete(base)).toBe(true);
    expect(toySafetyComplete({ ...base, maxAge: '' })).toBe(false);
    expect(toySafetyComplete({ ...base, minAge: '' })).toBe(false);
    expect(toySafetyComplete({ ...base, warnings: [] })).toBe(false);
    expect(toySafetyComplete({ ...base, ageWarning: '' })).toBe(false);
  });
});

describe('validateProductGpsr', () => {
  test('un producto completo pasa', () => {
    expect(validateProductGpsr(base).ok).toBe(true);
  });
  test('faltan modelo, identificador, país y declaración', () => {
    const r = validateProductGpsr({ ...base, model: '', identifier: '', saleCountries: [], sellerDeclaration: false });
    expect(r.ok).toBe(false);
    expect(r.itemErrors.model).toBeTruthy();
    expect(r.itemErrors.identifier).toBeTruthy();
    expect(r.itemErrors.saleCountries).toBeTruthy();
    expect(r.itemErrors.sellerDeclaration).toBeTruthy();
  });
  test('«no necesita advertencias» exime de la advertencia', () => {
    const r = validateProductGpsr({ ...base, warnings: [], noWarningsNeeded: true });
    expect(r.itemErrors.warnings).toBeUndefined();
    expect(r.ok).toBe(true);
  });
  test('una advertencia sin lengua o sin texto se marca', () => {
    const r = validateProductGpsr({ ...base, warnings: [{ language: '', text: 'x' }, { language: 'es_ES', text: '' }] });
    expect(r.warningErrors[0]).toBeTruthy();
    expect(r.warningErrors[1]).toBeTruthy();
    expect(r.ok).toBe(false);
  });
});
