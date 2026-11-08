import type { AuditResult } from '../../model/types';
import { detectProfile, pageInfo, type ProfileId } from './detect';

/**
 * Simulación de POST /ai-audit: tipo de producto de Amazon detectado, atributos que
 * Uony ha podido rellenar, los que faltan, recomendaciones y puntuaciones.
 */
interface AuditFixture {
  detected_category: string;
  name: string;
  required: string[];
  optional: string[];
  attributes: Record<string, string | number | boolean>;
  missingRequired: string[];
  missingOptional: string[];
  recommendations: string[];
  readiness: number;
  overall: number;
}

const FIXTURES: Record<Exclude<ProfileId, 'generic'>, AuditFixture> = {
  'make-it-possible': {
    detected_category: 'TOY_BUILDING_BLOCK',
    name: 'Juguetes de construcción',
    required: ['item_name', 'brand', 'color', 'material', 'ean', 'item_weight', 'item_width', 'item_height', 'item_depth'],
    optional: ['model_name', 'sku', 'power_source', 'special_features', 'finish_type', 'attachments_included'],
    attributes: {
      item_name: 'Make It Possible by Uonify: 25 piezas de madera para apilar y crear 3 personajes',
      brand: 'Uonify',
      model_name: 'Make It Possible',
      color: 'Azul y aqua',
      material: 'Madera',
      sku: 'UON-KIT-01',
      power_source: 'No necesita pilas',
    },
    missingRequired: ['ean', 'item_weight', 'item_width', 'item_height', 'item_depth'],
    missingOptional: ['special_features', 'finish_type', 'attachments_included'],
    recommendations: [
      'Añade el EAN de la caja: Amazon lo pide para crear la ficha o para solicitar la exención de GTIN.',
      'Indica el peso y las medidas del paquete (alto, ancho y fondo) para calcular el envío y la tarifa logística.',
      'Incluye la edad recomendada y las advertencias de seguridad del juguete exigidas en la UE.',
      'Menciona en el título las 25 piezas de madera y los tres personajes: mejora la búsqueda por «juego de construcción de madera».',
    ],
    readiness: 58,
    overall: 71,
  },
  frigorifico: {
    detected_category: 'REFRIGERATOR',
    name: 'Frigoríficos',
    required: ['item_name', 'brand', 'model_name', 'color', 'energy_efficiency_class', 'capacity', 'capacity_unit', 'item_width', 'item_height', 'item_depth', 'installation_type'],
    optional: ['ean', 'no_frost', 'item_weight', 'annual_energy_consumption', 'noise_level', 'climate_class', 'door_hinge_location', 'interior_light', 'door_alarm', 'fast_freeze', 'water_dispenser', 'ice_maker', 'wifi_enabled', 'finish_type', 'freezer_capacity'],
    attributes: {
      item_name: 'Kelvia KCB-363NF Frigorífico combi No Frost, 203 x 60 cm, 363 L, inox',
      brand: 'Kelvia',
      model_name: 'KCB-363NF',
      color: 'Inox',
      capacity: 363,
      capacity_unit: 'L',
      item_width: 60,
      item_height: 203,
      item_depth: 66,
      installation_type: 'Libre instalación',
      no_frost: true,
      item_weight: 72,
      ean: '8437014523651',
    },
    missingRequired: ['energy_efficiency_class'],
    missingOptional: ['annual_energy_consumption', 'noise_level', 'climate_class', 'door_hinge_location', 'interior_light', 'door_alarm', 'fast_freeze', 'water_dispenser', 'ice_maker', 'wifi_enabled', 'finish_type', 'freezer_capacity'],
    recommendations: [
      'Añade la clase de eficiencia energética de la etiqueta EPREL: es obligatoria para publicar frigoríficos en Amazon.es.',
      'Completa el consumo anual (kWh) y el nivel de ruido (dB): aparecen en la ficha energética y en los filtros de búsqueda.',
      'Separa la capacidad del frigorífico y la del congelador para salir en los filtros por litros.',
      'Lleva «No Frost» y «congelador inferior» a las viñetas: son los términos más buscados de la categoría.',
    ],
    readiness: 81,
    overall: 84,
  },
  televisor: {
    detected_category: 'TELEVISION',
    name: 'Televisores',
    required: ['item_name', 'brand', 'model_name', 'screen_size', 'screen_size_unit', 'resolution', 'display_technology', 'energy_efficiency_class', 'color'],
    optional: ['refresh_rate', 'hdr_format', 'smart_tv', 'operating_system', 'hdmi_ports', 'usb_ports', 'wifi_enabled', 'bluetooth', 'voice_control', 'tuner_type', 'audio_output_power', 'wall_mountable', 'item_weight'],
    attributes: {
      item_name: 'Lumora 55UQ8 Smart TV 55" 4K UHD QLED, HDR10+, 120 Hz',
      brand: 'Lumora',
      model_name: '55UQ8',
      screen_size: 55,
      screen_size_unit: 'pulgadas',
      resolution: '4K UHD',
      display_technology: 'QLED',
      color: 'Negro',
      refresh_rate: 120,
      hdr_format: 'HDR10+',
      smart_tv: true,
      hdmi_ports: 4,
      usb_ports: 2,
      wifi_enabled: true,
      bluetooth: true,
    },
    missingRequired: ['energy_efficiency_class'],
    missingOptional: ['operating_system', 'voice_control', 'tuner_type', 'audio_output_power', 'wall_mountable', 'item_weight'],
    recommendations: [
      'Añade la clase energética (SDR) de la etiqueta EPREL: es obligatoria para televisores en la UE.',
      'Indica el sintonizador (DVB-T2/C/S2) y la potencia de audio: son filtros habituales de la categoría.',
      'Especifica si admite soporte VESA y su medida para aparecer en las búsquedas de montaje en pared.',
    ],
    readiness: 86,
    overall: 88,
  },
  smartphone: {
    detected_category: 'CELLULAR_PHONE',
    name: 'Teléfonos móviles',
    required: ['item_name', 'brand', 'model_name', 'color', 'operating_system', 'screen_size', 'memory_storage_capacity', 'ram_memory_installed_size', 'wireless_network_technology'],
    optional: ['bluetooth', 'wifi_enabled', 'charging_time', 'special_features', 'item_weight'],
    attributes: {
      item_name: 'Norda X8 Pro 5G, pantalla AMOLED de 6,7", 12 GB de RAM, cámara de 108 MP, negro',
      brand: 'Norda',
      model_name: 'X8 Pro',
      color: 'Negro',
      operating_system: 'Android 15',
      screen_size: 6.7,
      ram_memory_installed_size: '12 GB',
      wireless_network_technology: '5G',
    },
    missingRequired: ['memory_storage_capacity'],
    missingOptional: ['bluetooth', 'wifi_enabled', 'charging_time', 'special_features', 'item_weight'],
    recommendations: [
      'Indica la capacidad de almacenamiento de cada variante (256 GB, 512 GB): es obligatoria y es el primer filtro de la categoría.',
      'Añade el peso y el tiempo de carga: los compradores comparan por autonomía.',
      'Crea una variante por color y capacidad en lugar de listarlas en el título.',
    ],
    readiness: 74,
    overall: 79,
  },
  lavadora: {
    detected_category: 'WASHER',
    name: 'Lavadoras',
    required: ['item_name', 'brand', 'model_name', 'capacity', 'capacity_unit', 'energy_efficiency_class', 'spin_speed', 'installation_type', 'item_width', 'item_height', 'item_depth'],
    optional: ['noise_level_washing', 'noise_level_spinning', 'number_of_programs', 'water_consumption', 'inverter_motor', 'delay_start', 'child_lock', 'quick_wash', 'half_load', 'aquastop', 'steam_function', 'drum_material', 'door_type'],
    attributes: {
      item_name: 'Kelvia KWM-914 Lavadora de carga frontal 9 kg, 1400 rpm, clase A',
      brand: 'Kelvia',
      model_name: 'KWM-914',
      capacity: 9,
      capacity_unit: 'kg',
      energy_efficiency_class: 'A',
      spin_speed: 1400,
      installation_type: 'Libre instalación',
      item_width: 60,
      item_height: 85,
      item_depth: 57,
      number_of_programs: 15,
      inverter_motor: true,
      delay_start: true,
      steam_function: true,
    },
    missingRequired: [],
    missingOptional: ['noise_level_washing', 'noise_level_spinning', 'water_consumption', 'child_lock', 'quick_wash', 'half_load', 'aquastop', 'drum_material', 'door_type'],
    recommendations: [
      'Añade el consumo de agua por ciclo y el ruido en centrifugado: forman parte de la etiqueta energética.',
      'Lleva «motor inverter», «vapor» e «inicio diferido» a las viñetas: están entre los términos más buscados.',
    ],
    readiness: 92,
    overall: 90,
  },
};

/** Auditoría de una URL sin perfil: solo nombre y marca; faltan color, material y peso. */
function genericFixture(input: string): AuditFixture {
  const { brand, title } = pageInfo(input);
  return {
    detected_category: 'HOME',
    name: 'Hogar',
    required: ['item_name', 'brand', 'color', 'material', 'item_weight'],
    optional: ['model_name', 'special_features', 'finish_type', 'item_width', 'item_height', 'item_depth'],
    attributes: { item_name: title, brand },
    missingRequired: ['color', 'material', 'item_weight'],
    missingOptional: ['model_name', 'special_features', 'finish_type', 'item_width', 'item_height', 'item_depth'],
    recommendations: [
      'Añade color, material y peso: Amazon los pide en la mayoría de categorías de hogar.',
      'Revisa el título: incluye marca, tipo de producto y la característica principal en menos de 150 caracteres.',
      'Sube al menos cinco imágenes con fondo blanco y 1000 px o más en el lado mayor.',
    ],
    readiness: 42,
    overall: 55,
  };
}

/** Respuesta simulada de /ai-audit para una entrada válida. */
export function buildAuditResult(input: string): AuditResult {
  const profile = detectProfile(input);
  const fixture = profile === 'generic' ? genericFixture(input) : FIXTURES[profile];
  return JSON.parse(JSON.stringify({
    detected_category: fixture.detected_category,
    amazon_product_type: {
      name: fixture.name,
      required_attributes: fixture.required,
      optional_attributes: fixture.optional,
    },
    ai_audit: {
      amazon_attributes: fixture.attributes,
      missing_required_attributes: fixture.missingRequired,
      missing_optional_attributes: fixture.missingOptional,
      recommendations: fixture.recommendations,
      audit_scores: { amazon_readiness: fixture.readiness, overall_score: fixture.overall },
    },
  })) as AuditResult;
}
