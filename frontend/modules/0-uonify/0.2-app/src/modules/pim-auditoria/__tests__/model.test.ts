import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIT, schemaFor, UONIFY_SCHEMAS, withDefaults } from '../model/schemas';
import { customFieldType, editFieldPatch, fieldStatus, primaryOwner, schemaBlocked, showIntro, validateFields } from '../model/validation';
import { amazonModel, applyAttributesToFields, optionalKeyToAdd, validAttributes } from '../model/amazon';
import { inputKind, mapScrapedProduct, scrapedProductError, scrapeInputError, scrapePayload } from '../model/scrape';
import { fieldKeyFromName, managerCustomField, movedCustomField, movedFieldData, neighbourOf, planApplyMapped } from '../model/fields';
import { display, translateAttribute } from '../model/translations';
import type { AuditState } from '../model/types';

const audit = (patch: Partial<AuditState> = {}): AuditState => ({ ...DEFAULT_AUDIT, ...patch });

describe('esquemas y validación', () => {
  it('una categoría sin esquema propio carga General (E18/E19)', () => {
    expect(schemaFor('Lavadora')).toBe(UONIFY_SCHEMAS.General);
    expect(schemaFor('Juego de construcción')).toBe(UONIFY_SCHEMAS.General);
    expect(schemaFor('Televisor')).toBe(UONIFY_SCHEMAS.Televisor);
    expect(schemaFor('toString')).toBe(UONIFY_SCHEMAS.General);
  });

  it('valida requeridos, opcionales y ajenos; el % cuenta solo el esquema (E20)', () => {
    const result = validateFields(UONIFY_SCHEMAS.General, { nombre: 'Silla', marca: '', color: 'Negro', extra: 'x' });
    expect(result.fieldValidations).toMatchObject({ nombre: 'valid', marca: 'missing', precio: 'missing', color: 'valid', modelo: 'review', extra: 'review' });
    expect(result.missingFields).toEqual(['marca', 'precio']);
    expect(result.completionProgress).toBe(20); // 2 de 10 campos del esquema
  });

  it('editar un campo lo valida y recalcula faltantes y progreso (E27)', () => {
    const schema = UONIFY_SCHEMAS.General;
    const base = audit({ uonifySchema: schema, editableFields: { nombre: 'Silla', marca: 'Kelvia' }, ...validateFields(schema, { nombre: 'Silla', marca: 'Kelvia' }) });
    expect(schemaBlocked(base)).toBe(true);
    const patch = editFieldPatch(base, 'precio', '49.90');
    expect(patch.fieldValidations?.precio).toBe('valid');
    expect(patch.missingFields).toEqual([]);
    expect(schemaBlocked({ ...base, ...patch })).toBe(false);
    expect(editFieldPatch(base, 'precio', '').fieldValidations?.precio).toBe('missing');
  });

  it('tono de la fila: requerido vacío, válido o revisar', () => {
    const base = audit({ uonifySchema: UONIFY_SCHEMAS.General, fieldValidations: { nombre: 'missing', color: 'valid' } });
    expect(fieldStatus(base, 'nombre', '').tone).toBe('pim-auditoria--required-empty');
    expect(fieldStatus(base, 'color', 'Negro')).toEqual({ validation: 'valid', isRequired: false, tone: 'pim-auditoria--valid' });
    expect(fieldStatus(base, 'otro', 'x').validation).toBe('review');
  });

  it('tipo del esquema → tipo de Atributos (E22: boolean → checkbox)', () => {
    expect(['number', 'boolean', 'select', 'date', 'text', undefined].map(customFieldType)).toEqual(['number', 'checkbox', 'select', 'date', 'text', 'text']);
  });

  it('una sola acción sólida: la de la vista con la tarea abierta', () => {
    expect(primaryOwner(audit())).toBe('audit');
    expect(primaryOwner(audit({ auditResult: {} }))).toBe('attributes');
    expect(primaryOwner(audit({ auditResult: {}, isCategoryConfirmed: false }))).toBe('selector');
    expect(primaryOwner(audit({ auditResult: {}, suggestedCategory: 'Televisor' }))).toBe('suggestion');
    expect(primaryOwner(audit({ suggestedCategory: 'Televisor', showSchemaComparison: true, uonifySchema: UONIFY_SCHEMAS.Televisor }))).toBe('schema');
  });

  it('las instrucciones solo se ven sin resultado ni campos mapeados (E03)', () => {
    expect(showIntro(audit())).toBe(true);
    expect(showIntro(audit({ auditResult: {} }))).toBe(false);
    expect(showIntro(audit({ mappedFields: { nombre: 'x' } }))).toBe(false);
  });

  it('la porción guardada se completa con los valores por defecto', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_AUDIT);
    expect(withDefaults({ auditUrl: 'x' }).auditUrl).toBe('x');
  });
});

describe('atributos de Amazon', () => {
  it('un 2xx sin ai_audit ni listas se pinta con valores vacíos (A04)', () => {
    const model = amazonModel(audit({ auditResult: {} }));
    expect(model).toMatchObject({ readiness: '0', overall: '0', totalAttributes: 0, completionPercentage: 0, detectedCategory: '' });
    expect(model.missingRows).toEqual([]);
    expect(amazonModel(audit({ auditResult: { ai_audit: null, amazon_product_type: null } })).productType.required_attributes).toEqual([]);
  });

  it('faltantes con etiqueta traducida, sin filas duplicadas (E12) y valores 0/false visibles (E13)', () => {
    const model = amazonModel(audit({
      auditResult: {
        amazon_product_type: { name: 'Frigoríficos', required_attributes: ['brand', 'energy_efficiency_class'], optional_attributes: ['no_frost'] },
        ai_audit: { missing_required_attributes: ['Clase energética'], missing_optional_attributes: ['water_dispenser'], audit_scores: { amazon_readiness: 81, overall_score: 84 } },
      },
      amazonAttributes: { brand: 'Kelvia', energy_efficiency_class: '', no_frost: false, capacity: 0 },
    }));
    expect(model.missingRows).toEqual([{ label: 'Clase energética', originalKey: 'energy_efficiency_class', value: '' }]);
    expect(model.existingRows.map(row => row.key)).toEqual(['brand', 'no_frost', 'capacity']);
    expect(model.existingRows[0].isRequired).toBe(true);
    expect(model.mappedCount).toBe(3);
    expect(model.completionPercentage).toBe(75);
    expect(display(false)).toBe('false');
    expect(display(0)).toBe('0');
    expect(translateAttribute('no_frost')).toBe('No Frost');
    expect(translateAttribute('constructor')).toBe('constructor');
  });

  it('un opcional no pisa un atributo que ya tiene valor (E15)', () => {
    const model = amazonModel(audit({
      auditResult: { amazon_product_type: { optional_attributes: ['no_frost', 'ice_maker'] } },
      amazonAttributes: { no_frost: true },
    }));
    expect(optionalKeyToAdd(model, 'No Frost')).toBeNull();
    expect(optionalKeyToAdd(model, 'Máquina de hielo')).toBe('ice_maker');
    expect(optionalKeyToAdd(model, 'door_alarm')).toBe('door_alarm');
  });

  it('«Aplicar Atributos» actualiza o crea campos y funde nombres repetidos (E17)', () => {
    const attrs = validAttributes({ brand: 'Kelvia', capacity: 363, total_capacity: 350, color: '', item_weight: null });
    expect(attrs).toEqual({ brand: 'Kelvia', capacity: 363, total_capacity: 350 });
    const existing = [{ id: 'f1', name: 'Marca', type: 'text', value: 'Otra', options: [], isConfirmed: true }];
    const fields = applyAttributesToFields(existing, attrs, 7);
    expect(fields[0].value).toBe('Kelvia');
    expect(existing[0].value).toBe('Otra'); // no muta la lista de entrada
    expect(fields.filter(field => field.name === 'Capacity')).toHaveLength(1);
    expect(fields[1]).toEqual({ id: 'audit_capacity_7', name: 'Capacity', value: 350, type: 'number', options: [], isConfirmed: true, source: 'audit_ia' });
  });
});

describe('análisis de la URL', () => {
  it('reconoce EAN, ASIN o URL y arma el cuerpo con product_id', () => {
    expect(inputKind('8437014523651')).toBe('ean');
    expect(inputKind(' B08XYZ1234 ')).toBe('asin');
    expect(inputKind('https://tienda.com/p/1')).toBe('url');
    expect(scrapePayload(' b08xyz1234 ', 'UON-KIT-01')).toEqual({ asin: 'b08xyz1234', product_id: 'UON-KIT-01' });
    expect(scrapePayload('https://tienda.com/p/1')).toEqual({ url: 'https://tienda.com/p/1' });
  });

  it('valida la entrada antes de analizar', () => {
    expect(scrapeInputError('   ')).toBe('Por favor ingresa una URL, ASIN o EAN válido');
    expect(scrapeInputError('http//mal')).toBe('URL inválida. Debe incluir http:// o https://');
    expect(scrapeInputError('https://tienda.com')).toBeNull();
    expect(scrapeInputError('B08XYZ1234')).toBeNull();
  });

  it('convierte el producto extraído en campos editables', () => {
    const mapped = mapScrapedProduct({
      title: 'Silla', sku: 'S-1', brand: 'Kelvia', price: 49, description: 'Corta', long_description: 'Larga',
      dimensions: { alto: '90 cm', ancho: '' }, specifications: { nombre: 'otra', color: 'Negro' },
    });
    expect(mapped).toEqual({ nombre: 'Silla', sku: 'S-1', marca: 'Kelvia', precio: 49, descripcion: 'Corta', descripcion_larga: 'Larga', alto: '90 cm', color: 'Negro' });
    expect(scrapedProductError({ error: 'Página no encontrada' })).toBe('Página no encontrada');
    expect(scrapedProductError({})).toMatch(/No se pudieron extraer datos/);
    expect(scrapedProductError({ title: 'x' })).toBeNull();
  });
});

describe('aplicar y gestionar campos', () => {
  it('reparte producto, galería y campos personalizados (E28)', () => {
    const plan = planApplyMapped({
      nombre: 'Silla', descripcion: 'Cómoda', precio: 49, ean: '8437014523651', peso: '7', tecnologia_no_frost: true, vacio: '', images: ['https://x/1.jpg'],
    }, UONIFY_SCHEMAS['Frigorífico Combi'], 5);
    expect(plan.productPatch).toEqual({ name: 'Silla', description: 'Cómoda', price: '49' });
    expect(plan.images).toEqual([{ id: 'scraped-5-0', url: 'https://x/1.jpg', file: null, source: 'scraped' }]);
    expect(plan.customFields.map(field => [field.name, field.type, field.value])).toEqual([
      ['Ean', 'number', '8437014523651'],
      ['Peso', 'number', '7'],
      ['Tecnologia no frost', 'checkbox', true],
    ]);
    expect(plan.appliedCount).toBe(8);
  });

  it('mover un campo crea uno sin confirmar con el tipo de Atributos', () => {
    const data = movedFieldData('tecnologia_no_frost', UONIFY_SCHEMAS['Frigorífico Combi']);
    expect(data).toMatchObject({ name: 'Tecnologia no frost', type: 'boolean', value: false, required: false });
    expect(movedCustomField('tecnologia_no_frost', data, 3)).toEqual({ id: 'field-3-tecnologia_no_frost', name: 'Tecnologia no frost', type: 'checkbox', value: false, options: [], isConfirmed: false });
    expect(movedFieldData('precio', UONIFY_SCHEMAS.General).required).toBe(true);
  });

  it('campo personalizado desde el formulario', () => {
    expect(fieldKeyFromName('Garantía extendida')).toBe('garantía_extendida');
    expect(managerCustomField('garantía_extendida', '3 años', 'text', 1)).toMatchObject({ name: 'Garantía extendida', value: '3 años', isConfirmed: false });
    expect(managerCustomField('regalo', 'true', 'checkbox', 1).value).toBe(true);
  });

  it('vecino para el foco: el siguiente o el anterior', () => {
    expect(neighbourOf(['a', 'b', 'c'], 'b')).toBe('c');
    expect(neighbourOf(['a', 'b', 'c'], 'c')).toBe('b');
    expect(neighbourOf(['a'], 'a')).toBeNull();
  });
});
