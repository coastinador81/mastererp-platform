import type { ScrapedProduct } from '../../model/types';
import { detectProfile, pageInfo, type ProfileId } from './detect';

/**
 * Simulación de POST /product-scraper: el producto que devuelve el servicio de
 * extracción para cada perfil. Marcas de electrodomésticos ficticias. El de Uonify es
 * el producto de ejemplo, «Make It Possible» by Uonify.
 */
const PRODUCTS: Record<Exclude<ProfileId, 'generic'>, ScrapedProduct> = {
  'make-it-possible': {
    title: 'Make It Possible by Uonify: 25 piezas de madera para apilar y crear 3 personajes',
    sku: 'UON-KIT-01',
    brand: 'Uonify',
    price: 34.9,
    description: 'Juego de 25 piezas de madera en azul y aqua, con detalles en blanco, para apilar, combinar y volver a imaginar.',
    long_description: 'Con las mismas piezas levantas una torre en equilibrio y construyes los tres personajes de Uonify: Productos, ERP y Agentes. Incluye una caja de presentación con una bandeja de tres huecos, uno para cada personaje.',
    specifications: {
      material: 'Madera',
      color: 'Azul y aqua, con detalles en blanco',
      piezas: 25,
      personajes: 'Productos (10 piezas), ERP (6 piezas) y Agentes (9 piezas)',
      pilas: 'No necesita pilas',
    },
    suggested_category: 'Juego de construcción',
  },
  frigorifico: {
    title: 'Kelvia KCB-363NF Frigorífico combi No Frost, 203 x 60 cm, 363 L, inox',
    sku: 'KCB-363NF-IX',
    ean: '8437014523651',
    brand: 'Kelvia',
    price: 749,
    description: 'Frigorífico combi de libre instalación con No Frost total, 363 litros y congelador inferior de tres cajones.',
    long_description: 'Frío multiflujo para mantener la temperatura estable en todos los estantes, cajón de frescura con control de humedad, iluminación LED y puertas reversibles. Acabado inox antihuellas.',
    dimensions: { dimensiones: '203 x 60 x 66 cm' },
    specifications: {
      modelo: 'KCB-363NF',
      capacidad_total: 363,
      color: 'Inox antihuellas',
      tecnologia_no_frost: true,
      tipo_congelador: 'Inferior',
      peso: 72,
    },
    suggested_category: 'Frigorífico Combi',
  },
  televisor: {
    title: 'Lumora 55UQ8 Smart TV 55" 4K UHD QLED, HDR10+, 120 Hz',
    sku: 'LM-55UQ8',
    ean: '8437014529127',
    brand: 'Lumora',
    price: 599,
    description: 'Televisor QLED de 55 pulgadas con resolución 4K UHD, HDR10+ y 120 Hz para deportes y videojuegos.',
    long_description: 'Procesador de imagen con escalado 4K, modo juego con baja latencia, sonido envolvente de 20 W y control por voz desde el mando.',
    specifications: {
      'tamaño_pantalla': 55,
      resolucion: '4K UHD',
      tecnologia_display: 'QLED',
      smart_tv: true,
      hdr: true,
      refresh_rate: 120,
      conectividad: '4 HDMI 2.1, 2 USB, wifi 6 y Bluetooth 5.2',
    },
    suggested_category: 'Televisor',
  },
  smartphone: {
    title: 'Norda X8 Pro 5G, pantalla AMOLED de 6,7", 12 GB de RAM, cámara de 108 MP, negro',
    sku: 'NDX8P-12-BK',
    ean: '8437014527215',
    brand: 'Norda',
    price: 649,
    description: 'Smartphone 5G con pantalla AMOLED de 6,7 pulgadas a 120 Hz, triple cámara de 108 MP y batería de 5000 mAh con carga rápida de 67 W.',
    specifications: {
      modelo: 'X8 Pro',
      ram: '12GB',
      'pantalla_tamaño': 6.7,
      camara_principal: 108,
      bateria: 5000,
      sistema_operativo: 'Android',
      color: 'Negro',
    },
    suggested_category: 'Smartphone',
  },
  lavadora: {
    title: 'Kelvia KWM-914 Lavadora de carga frontal 9 kg, 1400 rpm, clase A',
    sku: 'KWM-914',
    ean: '8437014521794',
    brand: 'Kelvia',
    price: 429,
    description: 'Lavadora de carga frontal de 9 kg con motor inverter, 15 programas y centrifugado de 1400 rpm.',
    long_description: 'Programa rápido de 15 minutos, vapor antialérgico, inicio diferido de hasta 24 horas y bloqueo infantil.',
    dimensions: { dimensiones: '85 x 60 x 57 cm' },
    specifications: {
      modelo: 'KWM-914',
      capacidad: '9 kg',
      velocidad_centrifugado: 1400,
      eficiencia_energetica: 'A',
      programas: 15,
      color: 'Blanco',
    },
    suggested_category: 'Lavadora',
  },
};

/** Producto de una URL sin perfil: título del enlace y marca del dominio; sin precio. */
function genericProduct(input: string): ScrapedProduct {
  const { host, brand, title } = pageInfo(input);
  return {
    title,
    brand,
    description: `${title}. Datos extraídos de la página del producto en ${host}.`,
    specifications: {},
  };
}

/** Respuesta simulada del scraper para una entrada válida. */
export function buildScrapedProduct(input: string): ScrapedProduct {
  const profile = detectProfile(input);
  const product = profile === 'generic' ? genericProduct(input) : PRODUCTS[profile];
  return JSON.parse(JSON.stringify(product)) as ScrapedProduct;
}
