/**
 * Etiquetas de atributos de Amazon (utils/attributeTranslations.ts del original, 110
 * etiquetas) y correspondencia con los nombres de campo de Atributos
 * (attributeMapping de ProductsPIMInterface.tsx, 32 entradas).
 */
export const ATTRIBUTE_TRANSLATIONS: Record<string, string> = {
  brand: 'Marca', model_name: 'Modelo', item_name: 'Nombre del producto', color: 'Color', sku: 'SKU', ean: 'EAN/GTIN', item_width: 'Ancho (cm)',
  item_height: 'Alto (cm)', item_depth: 'Profundidad (cm)', item_weight: 'Peso (kg)', interior_width: 'Ancho interior (cm)',
  interior_height: 'Alto interior (cm)', interior_depth: 'Profundidad interior (cm)', capacity: 'Capacidad', capacity_unit: 'Unidad de capacidad',
  total_capacity: 'Capacidad total', fridge_capacity: 'Capacidad frigorífico', freezer_capacity: 'Capacidad congelador',
  dust_capacity: 'Capacidad depósito', energy_efficiency_class: 'Clase energética', annual_energy_consumption: 'Consumo anual (kWh)',
  power_consumption: 'Consumo (W)', wattage: 'Potencia (W)', voltage: 'Voltaje (V)', water_consumption: 'Consumo de agua (L)',
  noise_level: 'Nivel de ruido (dB)', noise_level_washing: 'Ruido lavado (dB)', noise_level_spinning: 'Ruido centrifugado (dB)',
  number_of_programs: 'Número de programas', number_of_functions: 'Número de funciones', special_features: 'Características especiales',
  power_levels: 'Niveles de potencia', installation_type: 'Tipo de instalación', control_type: 'Tipo de control',
  heating_type: 'Tipo de calefacción', vacuum_type: 'Tipo de aspiradora', coffee_maker_type: 'Tipo de cafetera',
  display_technology: 'Tecnología de pantalla', drying_class: 'Clase de secado', defrost_system: 'Sistema de descongelación',
  filter_type: 'Tipo de filtro', spin_speed: 'Velocidad centrifugado (rpm)', turntable_diameter: 'Diámetro plato (cm)',
  door_hinge_location: 'Ubicación bisagra', finish_type: 'Tipo de acabado', material: 'Material', climate_class: 'Clase climática',
  display_type: 'Tipo de pantalla', screen_size: 'Tamaño pantalla', screen_size_unit: 'Unidad tamaño pantalla', resolution: 'Resolución',
  refresh_rate: 'Tasa de refresco (Hz)', smart_tv: 'Smart TV', operating_system: 'Sistema operativo', wifi_enabled: 'WiFi', bluetooth: 'Bluetooth',
  hdmi_ports: 'Puertos HDMI', usb_ports: 'Puertos USB', aquastop: 'Aquastop', delay_start: 'Inicio diferido', half_load: 'Media carga',
  third_rack: 'Tercer cesto', adjustable_upper_rack: 'Cesto superior ajustable', interior_light: 'Luz interior', child_lock: 'Bloqueo infantil',
  no_frost: 'No Frost', water_dispenser: 'Dispensador de agua', ice_maker: 'Máquina de hielo', door_alarm: 'Alarma puerta',
  fast_freeze: 'Congelación rápida', pyrolytic_cleaning: 'Limpieza pirolítica', steam_function: 'Función vapor', grill: 'Grill',
  grill_function: 'Función grill', convection: 'Convección', convection_function: 'Función convección', timer: 'Temporizador',
  timer_type: 'Tipo de temporizador', hepa_filter: 'Filtro HEPA', bagless: 'Sin bolsa', auto_empty: 'Vaciado automático',
  mapping_technology: 'Tecnología de mapeo', milk_frother: 'Espumador de leche', grinder_included: 'Molinillo incluido', programmable: 'Programable',
  auto_shutoff: 'Apagado automático', cup_warmer: 'Calienta tazas', battery_life: 'Duración batería', charging_time: 'Tiempo de carga',
  cord_length: 'Longitud cable (m)', power_source: 'Fuente de alimentación', suction_power: 'Potencia de succión (W)', pressure: 'Presión (bar)',
  water_tank_capacity: 'Capacidad depósito agua (L)', compatible_capsules: 'Cápsulas compatibles', attachments_included: 'Accesorios incluidos',
  hdr_format: 'Formato HDR', voice_control: 'Control por voz', tuner_type: 'Tipo de sintonizador', audio_output_power: 'Potencia salida audio (W)',
  wall_mountable: 'Montaje en pared', drum_material: 'Material tambor', door_type: 'Tipo de puerta', quick_wash: 'Lavado rápido',
  inverter_motor: 'Motor inverter', inverter_compressor: 'Compresor inverter', multi_airflow: 'Flujo de aire múltiple',
  telescopic_rails: 'Guías telescópicas', defrost_function: 'Función descongelación', auto_cook_programs: 'Programas de cocción automática',
};

/** Clave de Amazon → nombre del campo personalizado en Atributos. */
export const ATTRIBUTE_MAPPING: Record<string, string> = {
  brand: 'Marca', model_name: 'Nombre del Modelo', item_name: 'Nombre del Tipo de Artículo', sku: 'SKU', ean: 'EAN',
  item_width: 'Ancho', item_height: 'Alto', item_depth: 'Profundidad', item_weight: 'Peso del Paquete del Artículo',
  energy_efficiency_class: 'Calificación de Eficiencia Energética UE', voltage: 'Voltaje', wattage: 'Potencia',
  power_consumption: 'Consumo de energía', annual_energy_consumption: 'Annual Energy Consumption',
  capacity: 'Capacity', capacity_unit: 'Unidad de capacidad', total_capacity: 'Capacity',
  color: 'Color', finish_type: 'Tipo de acabado', material: 'Material',
  installation_type: 'Tipo de instalación',
  noise_level: 'Nivel de ruido', noise_level_washing: 'Ruido lavado', noise_level_spinning: 'Ruido centrifugado',
  water_consumption: 'Consumo de agua',
  number_of_programs: 'Número de programas', control_type: 'Tipo de control', display_type: 'Tipo de pantalla',
  spin_speed: 'Velocidad de centrifugado', drying_class: 'Clase de secado', defrost_system: 'Defrost System Type', climate_class: 'Clase climática',
};

/** Propiedad propia de un objeto (sin heredar de Object.prototype). */
export function own<T>(object: Record<string, T> | null | undefined, key: string): T | undefined {
  return object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

/** Etiqueta en español de una clave de Amazon (o la clave si no hay traducción). */
export const translateAttribute = (key: string): string => own(ATTRIBUTE_TRANSLATIONS, key) || key;

/** Texto visible de un valor: 0 y false se ven (E13); null/undefined, vacío. */
export const display = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Tiene valor (no null, undefined ni cadena vacía). */
export const hasValue = (value: unknown): boolean => value !== null && value !== undefined && value !== '';

/** Datos técnicos que van en monoespaciada. */
export const isTechnicalKey = (key: string): boolean => /^(sku|ean|asin|gtin|upc)$/i.test(String(key));
