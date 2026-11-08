/**
 * Propuesta de guion simulada (POST /video/plans): lo que devolvería el modelo de
 * texto del servidor con los datos de la ficha. Cumple las normas de vídeo de Amazon
 * (sin precios, ofertas, llamadas a comprar ni distintivos) y solo describe adultos.
 */

interface ProposalImage {
  id?: string;
  url?: string | null;
  source?: string;
}

interface ProposalRequest {
  destination?: string;
  product?: { name?: string; brand?: string; bullets?: unknown[] };
  images?: ProposalImage[];
}

const ACTIONS = {
  listing: [
    { camera: 'orbit', action: 'El producto gira despacio sobre un fondo neutro, con una luz lateral suave que realza su forma y sus materiales.' },
    { camera: 'push_in', action: 'Dos adultos usan el producto sobre una mesa de madera, con luz natural de mañana; la cámara se acerca despacio.' },
    { camera: 'pan', action: 'Detalle muy cercano de los acabados; la cámara se desliza de un lado a otro y muestra la textura.' },
    { camera: 'pedestal', action: 'El producto completo sobre la mesa, con todo lo que incluye; la cámara se eleva para mostrarlo entero.' },
  ],
  ads: [
    { camera: 'push_in', action: 'El producto aparece desde el primer segundo, bien iluminado sobre un fondo limpio, mientras la cámara se acerca.' },
    { camera: 'orbit', action: 'Un adulto usa el producto con naturalidad en un salón luminoso; la cámara lo rodea con un movimiento suave.' },
  ],
} as const;

const FALLBACK_TEXTS = ['Pensado para tu día a día', 'Materiales cuidados al detalle', 'Todo lo que necesitas, listo', 'Hecho para compartir'];
const TAGLINES = ['Pensado para ti.', 'Hecho para durar.', 'Diseño que se nota.'];

/** Corta en la última palabra que cabe (máx. 42 caracteres, como el texto en pantalla). */
function short(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : clean.slice(0, max)).replace(/[\s,;:.·-]+$/, '');
}

export function proposePlan(body: ProposalRequest) {
  const destination = body.destination === 'ads' ? 'ads' : 'listing';
  const steps = ACTIONS[destination];
  const images = (body.images || []).filter(image => image?.id);
  // Primero la foto principal, luego las de IA (escenas de uso) y el resto.
  const ordered = [images[0], ...images.filter(image => image.source === 'ai-generated'), ...images.slice(1)]
    .filter((image, index, list): image is ProposalImage => Boolean(image) && list.findIndex(other => other?.id === image?.id) === index);
  const bullets = (body.product?.bullets || [])
    .map(bullet => String(bullet || '').split(/:\s|:$|\.\s+(?=\p{Lu})|\.$/u)[0])
    .filter(Boolean);
  const texts = [...bullets, ...FALLBACK_TEXTS].map(text => short(text));
  const seed = String(body.product?.name || '').length;
  return {
    plan: {
      shots: steps.map((step, index) => {
        const image = ordered.length ? ordered[index % ordered.length] : null;
        return { image_id: image?.id ?? null, image_url: image?.url ?? null, action: step.action, camera: step.camera, text: texts[index] || '' };
      }),
      closing: { tagline: TAGLINES[seed % TAGLINES.length] },
    },
    model: 'gpt-5.1',
  };
}
