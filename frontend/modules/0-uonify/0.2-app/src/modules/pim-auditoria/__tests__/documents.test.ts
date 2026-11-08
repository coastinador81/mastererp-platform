import { describe, expect, it } from 'vitest';
import {
  excelRowToFields,
  extensionOf,
  findMatchingFields,
  isSupportedDocument,
  mergeExtracted,
  parseCSVDocument,
  parseCSVRows,
  parseJSONDocument,
  parseTextDocument,
  simulatedPdfData,
} from '../model/documents';
import {
  API_CONNECTIONS,
  credentialsLookComplete,
  exampleResults,
  missingRequiredCredentials,
  relevantProductData,
  resultDetails,
} from '../model/apiConnections';

describe('procesamiento de documentos', () => {
  it('reconoce las extensiones admitidas', () => {
    expect(extensionOf('Ficha.XLSX')).toBe('xlsx');
    expect(['a.csv', 'b.pdf', 'c.json', 'd.txt', 'e.xls'].every(isSupportedDocument)).toBe(true);
    expect(isSupportedDocument('foto.png')).toBe(false);
  });

  it('CSV: primera fila de datos con cabeceras normalizadas, comillas y separador detectado', () => {
    expect(parseCSVDocument('Peso Neto,Dimensiones,Vacío\n"2,5 kg","45 x 30 x 25 cm",\n9 kg,x,y')).toEqual({ peso_neto: '2,5 kg', dimensiones: '45 x 30 x 25 cm' });
    expect(parseCSVDocument('﻿peso;garantía\r\n3 kg;"24 ""meses"""\r\n')).toEqual({ peso: '3 kg', 'garantía': '24 "meses"' });
    expect(parseCSVRows('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => parseCSVDocument('solo,cabeceras\n')).toThrow('CSV vacío');
  });

  it('Excel: la primera fila; vacío si no hay filas', () => {
    expect(excelRowToFields({ 'Peso Neto': 2.5, Color: 'Negro' })).toEqual({ peso_neto: 2.5, color: 'Negro' });
    expect(() => excelRowToFields(undefined)).toThrow('Excel vacío');
  });

  it('TXT «Clave: valor», JSON y PDF simulado', () => {
    expect(parseTextDocument('Peso: 2.5 kg\nsin separador\nGarantía Total:  24 meses ')).toEqual({ peso: '2.5 kg', 'garantía_total': '24 meses' });
    expect(parseJSONDocument('{"peso":"3 kg"}')).toEqual({ peso: '3 kg' });
    expect(() => parseJSONDocument('{')).toThrow('JSON inválido');
    expect(() => parseJSONDocument(null)).toThrow('Formato inválido');
    expect(simulatedPdfData(['peso', 'marca', 'dimensiones'])).toEqual({ peso: '2.5 kg', dimensiones: '45 x 30 x 25 cm' });
  });

  it('busca los campos faltantes en las claves extraídas', () => {
    const data = { peso_neto: '2 kg', 'eficiencia energetica': 'A', color: 'Rojo' };
    expect(findMatchingFields(data, ['peso', 'eficiencia_energetica', 'precio'])).toEqual({ peso: '2 kg', eficiencia_energetica: 'A' });
  });

  it('une los datos de los archivos procesados con éxito', () => {
    expect(mergeExtracted([
      { status: 'success', extractedData: { peso: '1' } },
      { status: 'error', extractedData: { color: 'x' } },
      { status: 'success', extractedData: { peso: '2', ean: '1' } },
    ])).toEqual({ peso: '2', ean: '1' });
  });
});

describe('conexiones API externas (simuladas)', () => {
  const sheets = API_CONNECTIONS.find(connection => connection.id === 'google-sheets')!;
  const shopify = API_CONNECTIONS.find(connection => connection.id === 'shopify')!;

  it('seis plataformas, como el original', () => {
    expect(API_CONNECTIONS.map(connection => connection.name)).toEqual(['Google Sheets', 'Microsoft 365', 'WordPress', 'PrestaShop', 'Magento', 'Shopify']);
  });

  it('nombra por su etiqueta los campos requeridos vacíos (E30)', () => {
    expect(missingRequiredCredentials(sheets, { spreadsheetId: ' ' })).toEqual(['ID de Hoja de Cálculo', 'API Key de Google']);
    expect(missingRequiredCredentials(sheets, { spreadsheetId: 'abc', apiKey: 'k' })).toEqual([]);
  });

  it('la comprobación local solo mira la longitud (no valida contra la plataforma)', () => {
    expect(credentialsLookComplete({ a: 'corta', b: '12345678901' })).toBe(true);
    expect(credentialsLookComplete({ a: 'corta' })).toBe(false);
  });

  it('resultados de ejemplo por tipo de plataforma y datos que se aplican', () => {
    const [sheet] = exampleResults(sheets, 'UON-KIT-01');
    expect(sheet).toMatchObject({ sku: 'UON-KIT-01', name: 'Producto UON-KIT-01', source: 'Google Sheets', peso: '2.8 kg' });
    expect(resultDetails(sheet).map(([key]) => key)).toEqual(['peso', 'dimensiones', 'garantía', 'certificaciones', 'color', 'materiales']);
    const [shop] = exampleResults(shopify, 'X');
    expect(shop).toMatchObject({ precio: '299.99', stock: 45, marca: 'TechBrand' });
    expect(relevantProductData(shop, ['precio', 'marca', 'color'])).toEqual({ precio: '299.99', marca: 'TechBrand', peso: '3.1 kg', dimensiones: '50 x 35 x 28 cm' });
  });
});
