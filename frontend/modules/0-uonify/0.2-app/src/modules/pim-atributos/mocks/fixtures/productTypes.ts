/**
 * Catálogo simulado de categorías (product types) de Amazon.es, con el nombre
 * visible en español y palabras con las que la gente las busca. Lo usa la
 * simulación de GET /amazon/product-types/search (Product Type Definitions API).
 */
export interface ProductTypeFixture {
  name: string;
  displayName: string;
  keywords: string[];
}

export const PRODUCT_TYPES: ProductTypeFixture[] = [
  { name: 'TOY_FIGURE', displayName: 'Figura de juguete', keywords: ['juguete', 'figura', 'muñeco', 'personaje'] },
  { name: 'TOY_BUILDING_BLOCK', displayName: 'Bloques de construcción', keywords: ['juguete', 'construccion', 'bloques', 'piezas', 'apilables', 'madera'] },
  { name: 'BOARD_GAME', displayName: 'Juego de mesa', keywords: ['juego', 'mesa', 'familiar', 'tablero', 'fichas'] },
  { name: 'PUZZLES', displayName: 'Puzles y rompecabezas', keywords: ['puzle', 'puzzle', 'rompecabezas', 'juego', 'piezas'] },
  { name: 'EDUCATIONAL_TOY', displayName: 'Juguete educativo', keywords: ['juguete', 'educativo', 'aprendizaje', 'montessori', 'habilidad'] },
  { name: 'TOY_STACKING_BLOCK', displayName: 'Juego de apilar', keywords: ['apilar', 'torre', 'equilibrio', 'juego', 'bloques', 'madera'] },
  { name: 'ART_CRAFT_KIT', displayName: 'Kit de manualidades', keywords: ['manualidades', 'arte', 'kit', 'creativo', 'pintura'] },
  { name: 'SHOES', displayName: 'Calzado', keywords: ['zapatos', 'zapatillas', 'calzado', 'botas', 'sandalias'] },
  { name: 'SHIRT', displayName: 'Camisa y camiseta', keywords: ['camisa', 'camiseta', 'ropa', 'polo'] },
  { name: 'PANTS', displayName: 'Pantalones', keywords: ['pantalon', 'vaqueros', 'ropa', 'chinos'] },
  { name: 'COAT', displayName: 'Abrigos y chaquetas', keywords: ['abrigo', 'chaqueta', 'parka', 'ropa'] },
  { name: 'HANDBAG', displayName: 'Bolsos', keywords: ['bolso', 'bandolera', 'cartera', 'accesorio'] },
  { name: 'LUGGAGE', displayName: 'Equipaje y maletas', keywords: ['maleta', 'equipaje', 'viaje', 'trolley', 'mochila'] },
  { name: 'BACKPACK', displayName: 'Mochilas', keywords: ['mochila', 'escolar', 'viaje', 'portatil'] },
  { name: 'WATCH', displayName: 'Relojes', keywords: ['reloj', 'smartwatch', 'pulsera'] },
  { name: 'JEWELRY', displayName: 'Joyería', keywords: ['joya', 'collar', 'anillo', 'pendientes', 'pulsera'] },
  { name: 'SUNGLASSES', displayName: 'Gafas de sol', keywords: ['gafas', 'sol', 'polarizadas'] },
  { name: 'CELLULAR_PHONE_CASE', displayName: 'Fundas para móvil', keywords: ['funda', 'movil', 'carcasa', 'telefono'] },
  { name: 'HEADPHONES', displayName: 'Auriculares', keywords: ['auriculares', 'cascos', 'bluetooth', 'sonido'] },
  { name: 'SPEAKERS', displayName: 'Altavoces', keywords: ['altavoz', 'bluetooth', 'sonido', 'audio'] },
  { name: 'PORTABLE_ELECTRONIC_DEVICE_STAND', displayName: 'Soportes para dispositivos', keywords: ['soporte', 'movil', 'tablet', 'portatil'] },
  { name: 'CHARGING_ADAPTER', displayName: 'Cargadores y adaptadores', keywords: ['cargador', 'adaptador', 'usb', 'enchufe'] },
  { name: 'COMPUTER_ADD_ON', displayName: 'Accesorios de ordenador', keywords: ['ordenador', 'teclado', 'raton', 'hub', 'usb'] },
  { name: 'LAMP', displayName: 'Lámparas', keywords: ['lampara', 'luz', 'iluminacion', 'mesa', 'pie'] },
  { name: 'LIGHT_BULB', displayName: 'Bombillas', keywords: ['bombilla', 'led', 'luz'] },
  { name: 'HOME_BED_AND_BATH', displayName: 'Ropa de cama y baño', keywords: ['sabanas', 'toalla', 'edredon', 'cama', 'baño'] },
  { name: 'HOME_ORGANIZERS_AND_STORAGE', displayName: 'Organización y almacenaje', keywords: ['organizador', 'caja', 'almacenaje', 'estanteria'] },
  { name: 'FURNITURE', displayName: 'Muebles', keywords: ['mueble', 'mesa', 'silla', 'estanteria', 'madera'] },
  { name: 'DECORATIVE_ITEM', displayName: 'Objetos decorativos', keywords: ['decoracion', 'jarron', 'figura', 'cuadro', 'hogar'] },
  { name: 'KITCHEN', displayName: 'Menaje de cocina', keywords: ['cocina', 'sarten', 'olla', 'utensilio', 'menaje'] },
  { name: 'DRINKING_CUP', displayName: 'Tazas y vasos', keywords: ['taza', 'vaso', 'mug', 'termo'] },
  { name: 'COFFEE_MAKER', displayName: 'Cafeteras', keywords: ['cafetera', 'cafe', 'espresso', 'capsulas'] },
  { name: 'SMALL_HOME_APPLIANCES', displayName: 'Pequeño electrodoméstico', keywords: ['electrodomestico', 'batidora', 'tostadora', 'freidora'] },
  { name: 'REFRIGERATOR', displayName: 'Frigoríficos', keywords: ['frigorifico', 'nevera', 'congelador', 'combi'] },
  { name: 'VACUUM_CLEANER', displayName: 'Aspiradoras', keywords: ['aspiradora', 'robot', 'limpieza', 'escoba'] },
  { name: 'SKIN_CARE_AGENT', displayName: 'Cuidado de la piel', keywords: ['crema', 'piel', 'serum', 'hidratante', 'cosmetica'] },
  { name: 'HAIR_CARE_PRODUCT', displayName: 'Cuidado del cabello', keywords: ['champu', 'cabello', 'pelo', 'mascarilla'] },
  { name: 'PERSONAL_CARE_APPLIANCE', displayName: 'Aparatos de cuidado personal', keywords: ['secador', 'plancha', 'afeitadora', 'depiladora'] },
  { name: 'NUTRITIONAL_SUPPLEMENT', displayName: 'Suplementos nutricionales', keywords: ['suplemento', 'vitaminas', 'proteina', 'nutricion'] },
  { name: 'PET_SUPPLIES', displayName: 'Productos para mascotas', keywords: ['mascota', 'perro', 'gato', 'comedero', 'correa'] },
  { name: 'SPORTING_GOODS', displayName: 'Artículos deportivos', keywords: ['deporte', 'fitness', 'pesas', 'esterilla', 'yoga'] },
  { name: 'BICYCLE', displayName: 'Bicicletas', keywords: ['bicicleta', 'bici', 'ciclismo'] },
  { name: 'OUTDOOR_LIVING', displayName: 'Jardín y exterior', keywords: ['jardin', 'exterior', 'terraza', 'barbacoa'] },
  { name: 'TOOLS', displayName: 'Herramientas', keywords: ['herramienta', 'taladro', 'destornillador', 'bricolaje'] },
  { name: 'OFFICE_PRODUCTS', displayName: 'Material de oficina', keywords: ['oficina', 'papeleria', 'boligrafo', 'cuaderno'] },
  { name: 'ABIS_BOOK', displayName: 'Libros', keywords: ['libro', 'novela', 'lectura'] },
  { name: 'BABY_PRODUCT', displayName: 'Productos para bebé', keywords: ['bebe', 'chupete', 'biberon', 'carrito', 'infantil'] },
  { name: 'GIFT_CARD', displayName: 'Tarjetas regalo', keywords: ['regalo', 'tarjeta'] },
  { name: 'PRODUCT', displayName: 'Producto genérico', keywords: ['producto', 'generico', 'otros'] },
];

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Coincidencias por nombre visible, nombre técnico o palabra clave (sin tildes), las más relevantes primero. */
export function searchProductTypeFixtures(keywords: string, limit = 12): Array<{ name: string; displayName: string }> {
  const words = normalize(keywords).split(/\s+/).filter(word => word.length >= 2);
  if (words.length === 0) return [];
  return PRODUCT_TYPES
    .map(type => {
      const haystack = [type.displayName, type.name.replace(/_/g, ' '), ...type.keywords].map(normalize);
      const score = words.reduce((total, word) => total + (haystack.some(text => text.includes(word)) ? 1 : 0)
        + (normalize(type.displayName).startsWith(word) ? 1 : 0), 0);
      return { type, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ type }) => ({ name: type.name, displayName: type.displayName }));
}
