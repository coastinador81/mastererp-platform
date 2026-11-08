import type { GenerateProductInfo } from '../model/ecosystem';

/**
 * Lo que respondería Uony en POST /ai-aplus: el algoritmo del original
 * (generateAdvancedAIContent, TextOverlayModule.tsx 258-298) con los datos del
 * producto que envía la pestaña. Titular al azar entre cinco variantes; cuerpo a
 * partir de la descripción o, si no hay, de sus atributos.
 */
export function generateAplusCopy(product: Partial<GenerateProductInfo>, random: () => number = Math.random): { headline: string; bodyText: string } {
  const name = product.name || 'Producto Innovador';
  const category = product.category || 'Tecnología';
  const brand = product.brand || 'Uonify';
  const description = product.description || '';
  const features = (product.custom_attributes || [])
    .filter(attr => attr.type === 'text' || attr.type === 'textarea')
    .map(attr => attr.value)
    .filter(Boolean)
    .join(', ');
  const titles = [
    `${name} de ${brand}: Innovación que Transforma`,
    `Descubre ${name}: ${category} de Nueva Generación`,
    `${name} - La Evolución del ${category} Moderno`,
    `Experimenta ${name}: Tecnología ${brand} Avanzada`,
    `${name}: Redefiniendo el ${category} del Futuro`,
  ];
  const pick = <T,>(list: T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const headline = pick(titles);
  if (description) return { headline, bodyText: `${description.slice(0, 100)}${description.length > 100 ? '...' : ''}` };
  const bodies = [
    `Revoluciona tu experiencia con ${name}. ${features ? `Con ${features}, ` : ''}este ${category.toLowerCase()} de ${brand} combina diseño elegante con funcionalidad superior para ofrecerte lo mejor en innovación.`,
    `${name} representa la perfecta fusión entre tecnología y diseño. ${features ? `Gracias a ${features}, ` : ''}cada detalle ha sido cuidadosamente diseñado para superar tus expectativas.`,
    `Sumérgete en un mundo de posibilidades con ${name}. ${features ? `Equipado con ${features}, ` : ''}este producto de ${brand} redefine los estándares de calidad y rendimiento.`,
    `Descubre por qué ${name} es la elección perfecta. ${features ? `Con ${features} y ` : ''}respaldado por la confianza de ${brand}, experimenta la excelencia en cada uso.`,
  ];
  return { headline, bodyText: pick(bodies) };
}
