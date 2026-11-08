import {
  emptyBrandProfile, manufacturerInEu, responsibleRequired, validateBrandProfile,
  type BrandGpsrProfile,
} from '../model/brandGpsrProfile';

function inEu(): BrandGpsrProfile {
  return {
    brand: 'Basic Mini Bricks',
    manufacturer: { name: 'Basic Mini Bricks, S.L.', postalAddress: { street: 'Calle Mayor 10', postalCode: '28013', city: 'Madrid', country: 'ES' }, email: 'calidad@bmb.example', pointOfContact: '' },
    euResponsible: null, autoApply: true,
  };
}
function outEu(): BrandGpsrProfile {
  return {
    ...inEu(), brand: 'Nordic Toys',
    manufacturer: { name: 'Nordic Toys AS', postalAddress: { street: 'Storgata 5', postalCode: '0155', city: 'Oslo', country: 'NO' }, email: 'ventas@nt.example', pointOfContact: '' },
    euResponsible: { type: 'authorized_representative', name: 'EU Rep GmbH', postalAddress: { street: 'Hauptstraße 22', postalCode: '10115', city: 'Berlín', country: 'DE' }, email: 'eu@rep.example' },
  };
}

describe('GPSR por marca (alineado)', () => {
  test('derivación UE y obligatoriedad condicional del responsable', () => {
    expect(manufacturerInEu(inEu())).toBe(true);
    expect(responsibleRequired(inEu())).toBe(false);
    expect(manufacturerInEu(outEu())).toBe(false);
    expect(responsibleRequired(outEu())).toBe(true);
  });

  test('fabricante en la UE: un perfil completo pasa sin responsable', () => {
    expect(validateBrandProfile(inEu())).toEqual({});
  });

  test('fabricante fuera de la UE: válido con responsable completo', () => {
    expect(validateBrandProfile(outEu())).toEqual({});
  });

  test('fuera de la UE sin responsable: se exige', () => {
    const r = validateBrandProfile({ ...outEu(), euResponsible: null });
    expect(r.euResponsible).toBeTruthy();
  });

  test('correo obligatorio con formato (no vale web)', () => {
    const r = validateBrandProfile({ ...inEu(), manufacturer: { ...inEu().manufacturer, email: 'https://empresa.example' } });
    expect(r['manufacturer.email']).toBeTruthy();
  });

  test('dirección estructurada: faltan calle/CP/ciudad/país', () => {
    const r = validateBrandProfile({ ...inEu(), manufacturer: { ...inEu().manufacturer, postalAddress: { street: '', postalCode: '', city: '', country: '' } } });
    expect(r['manufacturer.postalAddress.street']).toBeTruthy();
    expect(r['manufacturer.postalAddress.postalCode']).toBeTruthy();
    expect(r['manufacturer.postalAddress.city']).toBeTruthy();
    expect(r['manufacturer.postalAddress.country']).toBeTruthy();
  });

  test('el responsable debe estar en la UE', () => {
    const r = validateBrandProfile({ ...outEu(), euResponsible: { ...outEu().euResponsible!, postalAddress: { street: 'x', postalCode: '1', city: 'y', country: 'US' } } });
    expect(r['euResponsible.postalAddress.country']).toBeTruthy();
  });

  test('una marca nueva vacía no valida (faltan datos)', () => {
    expect(Object.keys(validateBrandProfile(emptyBrandProfile())).length).toBeGreaterThan(0);
  });
});
