import { SERVICES, DEFAULT_VIEW, type ServiceId } from './services';

/**
 * Enrutado de una petición por intención (app-shell.js, `routePrompt`): qué
 * servicio abre Uony y qué responde. Con el backend de IA esta decisión la tomará
 * el modelo; mientras, se conserva exactamente la del prototipo.
 */
export interface PromptRoute {
  service: ServiceId | null;
  response: string;
  /** Petición de subir o crear en Producto: vuelve al catálogo. */
  catalog?: boolean;
}

/** Peticiones de navegación: las comparten texto y transcripción de voz. */
export function wantsChatOnly(text: string): boolean {
  const clean = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^[¡¿]/, '').replace(/^(?:uony|wuni|woni)[, ]+/, '');
  if (/\bno\b/.test(clean)) return false;
  return /^(?:por favor[, ]+)?(?:(?:llevame|vuelve|volver|regresa|regresar|ir|vamos|quiero (?:ir|volver|regresar)) (?:a |al |a la )?(?:pantalla principal|inicio|chat|conversacion)|(?:limpia|limpiame|despeja|despejame) (?:la )?(?:interfaz|pantalla)|(?:muestra|muestrame|deja|dejame|quiero ver) (?:solo |solamente )(?:el )?(?:chat|conversacion)|(?:oculta|quita) (?:las )?barras laterales)(?:[.!?, ]|$)/.test(clean);
}

export function routePrompt(text: string, activeService: ServiceId | null): PromptRoute {
  if (/(imp[oó]rt|trae|descarg|sincroniz|conect)/i.test(text) && /(amazon|shopify|marketplace|cat[aá]logo|productos)/i.test(text)) return { service: 'nexus', response: 'Para importar productos, primero conecta la cuenta del canal en Nexus.' };
  if (/(producto|cat[aá]logo|ficha|atributo|descripci[oó]n|gpsr|im[aá]gen|contenido a\+)/i.test(text)) return { service: 'producto', catalog: /(sub[ie]|a[ñn]ad|carg|nuev|crea)/i.test(text), response: 'Aquí tienes tu catálogo. Puedes importar tus productos o crear uno nuevo, o contarme qué quieres subir y lo preparo contigo.' };
  if (/(inventario|compras|venta|factura|precio|coste|erp)/i.test(text)) return { service: 'erp', response: 'He abierto ERP para trabajar con tu operación.' };
  if (/(anal[ií]tica|m[aá]rgen|resultado|informe|m[eé]trica)/i.test(text)) return { service: 'analitica', response: 'He abierto Analítica para revisar tus datos.' };
  if (/(auditor[ií]a|captura|fabricante|scrap)/i.test(text)) return { service: 'auditoria', response: 'He abierto Captura y auditoría.' };
  if (/(agente|automatiz)/i.test(text)) return { service: 'agentes', response: 'He abierto Agentes para organizar esta tarea.' };
  if (/(proveedor|f[aá]brica)/i.test(text)) return { service: 'fabrica', response: 'He abierto Fábrica y proveedores.' };
  if (/(log[ií]stica|env[ií]o|almac[eé]n)/i.test(text)) return { service: 'logistica', response: 'He abierto Logística.' };
  if (/(academy|formaci[oó]n|curso)/i.test(text)) return { service: 'academy', response: 'He abierto Academy.' };
  // Nada coincide: se sigue hablando, en el servicio abierto si lo hay y si no en
  // una conversación. Nunca se abre Producto por defecto.
  if (activeService) return { service: activeService, response: `Sigo contigo en ${SERVICES[activeService].name}. ¿Qué quieres hacer ahora?` };
  return { service: null, response: 'Estoy aquí para ayudarte con tu negocio. Puedo preparar y subir tus productos a Amazon, conectar tu cuenta de Amazon o revisar tu catálogo. ¿Por dónde empezamos?' };
}

/** Dónde estaba la persona al enviar, y dónde está al llegar la respuesta. */
export interface ReplyPlace {
  service: ServiceId | null;
  view: string;
}

export interface ResolvedReply {
  /** Sigue en el mismo hilo, servicio y vista: la respuesta puede llevarla. */
  stayed: boolean;
  reply: string;
  /** Servicio y vista que quedan en el hilo (solo si `stayed`). */
  service: ServiceId | null;
  view: string;
  /** Vuelve al catálogo de Producto (cierra la ficha). */
  toCatalog: boolean;
  /** Hay que navegar: cambia de servicio o vuelve al catálogo. */
  navigate: boolean;
}

/**
 * Qué hace la respuesta al llegar (`finish` de sendPrompt): si la persona se fue a
 * otro sitio mientras Uony pensaba, la respuesta espera en su hilo y no la trae de
 * vuelta. En el mismo servicio se conserva su vista (una ficha nueva abierta sigue
 * abierta); una petición de subir o crear en Producto vuelve al catálogo.
 */
export function resolveReply(input: {
  route: PromptRoute;
  origin: ReplyPlace;
  current: ReplyPlace;
  sameThread: boolean;
  /** Producto tiene ficha abierta ahora (nueva o elegida). */
  hasSheet: boolean;
  /** Nombre del producto de la ficha abierta, si se conoce. */
  sheetTitle: string | null;
}): ResolvedReply {
  const { route, origin, current } = input;
  const stayed = input.sameThread && current.service === origin.service && current.view === origin.view;
  if (!stayed) return { stayed, reply: route.response, service: current.service, view: current.view, toCatalog: false, navigate: false };
  const toCatalog = route.service === 'producto' && (origin.service !== 'producto' || route.catalog === true);
  const view = route.service === origin.service && !toCatalog ? origin.view : DEFAULT_VIEW;
  const sheetOpen = route.service === 'producto' && !toCatalog && input.hasSheet;
  const reply = sheetOpen ? `Sigo contigo en la ficha de «${input.sheetTitle || 'tu nuevo producto'}». ¿Qué quieres cambiar?` : route.response;
  return { stayed, reply, service: route.service, view, toCatalog, navigate: route.service !== origin.service || toCatalog };
}
