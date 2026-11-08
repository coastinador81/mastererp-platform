import { absoluteUrl, type SeoEnv } from './env';
import { PUBLIC_PLANS, planSummary, type PublicPlan } from './plans';
import { DEFAULT_IMAGE, SITE, type SeoImage } from './site';
import type { JsonLdNode, SeoPage, SeoQuestion } from './types';

/**
 * Datos estructurados (schema.org) de la web pública: Organization, WebSite,
 * WebPage, BreadcrumbList, SoftwareApplication con las ofertas de los planes y
 * FAQPage. Todos van en un único @graph enlazado por @id, que es lo que mejor leen
 * Google y los buscadores de IA.
 */
const ids = (env: SeoEnv) => ({
  organization: `${env.siteUrl}/#organization`,
  website: `${env.siteUrl}/#website`,
  software: `${env.siteUrl}/#software`,
  logo: `${env.siteUrl}/#logo`,
});

function imageObject(image: SeoImage, env: SeoEnv, id?: string): JsonLdNode {
  return {
    '@type': 'ImageObject',
    ...(id ? { '@id': id } : {}),
    url: absoluteUrl(image.path, env),
    width: image.width,
    height: image.height,
    caption: image.alt,
  };
}

export function organizationLd(env: SeoEnv): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': ids(env).organization,
    name: SITE.name,
    legalName: SITE.legalName,
    url: absoluteUrl('/', env),
    email: SITE.email,
    slogan: SITE.slogan,
    description: SITE.description,
    logo: imageObject(SITE.logo, env, ids(env).logo),
    image: { '@id': ids(env).logo },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: SITE.email,
      availableLanguage: ['es', 'en'],
    },
  };
}

export function websiteLd(env: SeoEnv): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': ids(env).website,
    url: absoluteUrl('/', env),
    name: SITE.name,
    alternateName: `${SITE.name} — ${SITE.slogan}`,
    description: SITE.description,
    inLanguage: SITE.language,
    publisher: { '@id': ids(env).organization },
  };
}

export function webPageLd(page: SeoPage, env: SeoEnv): JsonLdNode {
  const url = absoluteUrl(page.path, env);
  return {
    '@type': page.pageType ?? 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    inLanguage: SITE.language,
    isPartOf: { '@id': ids(env).website },
    about: { '@id': page.software ? ids(env).software : ids(env).organization },
    primaryImageOfPage: imageObject(page.image ?? DEFAULT_IMAGE, env),
    ...(page.breadcrumbs?.length ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
  };
}

/** Migas: Inicio › … › página. */
export function breadcrumbLd(page: SeoPage, env: SeoEnv): JsonLdNode | null {
  if (!page.breadcrumbs?.length) return null;
  const trail = [{ name: 'Inicio', path: '/' }, ...page.breadcrumbs];
  return {
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(page.path, env)}#breadcrumb`,
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path, env),
    })),
  };
}

/** Oferta de un plan con precio público (Personalizado no tiene: se habla con ventas). */
export function planOfferLd(plan: PublicPlan, env: SeoEnv): JsonLdNode | null {
  if (plan.monthlyPrice === null) return null;
  const price = plan.monthlyPrice.toFixed(2);
  return {
    '@type': 'Offer',
    name: `Plan ${plan.name}`,
    description: planSummary(plan),
    price,
    priceCurrency: 'EUR',
    category: plan.monthlyPrice === 0 ? 'free' : 'subscription',
    url: absoluteUrl('/', env),
    seller: { '@id': ids(env).organization },
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: 'EUR',
      unitCode: 'MON',
      unitText: 'mes',
      valueAddedTaxIncluded: true,
    },
  };
}

export function softwareApplicationLd(env: SeoEnv, plans: readonly PublicPlan[] = PUBLIC_PLANS): JsonLdNode {
  return {
    '@type': 'SoftwareApplication',
    '@id': ids(env).software,
    name: SITE.name,
    url: absoluteUrl('/', env),
    description: SITE.description,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Gestión de catálogo y comercio electrónico con IA',
    operatingSystem: 'Web',
    inLanguage: SITE.language,
    publisher: { '@id': ids(env).organization },
    image: imageObject(DEFAULT_IMAGE, env),
    featureList: [
      'Fichas de producto con atributos, descripciones, viñetas, palabras clave y GPSR',
      'Imágenes de producto, contenido A+ y modelos 3D con inteligencia artificial',
      'Estudio creativo de vídeo y contenido para redes con la IA de Google',
      'Auditoría de fichas con IA a partir de una URL, un ASIN o un EAN',
      'Publicación de productos en Amazon',
      'Nexus: conexión de tus canales y sistemas para que la información siga su recorrido',
      'Uony, la IA de Uonify, con la tecnología de Google',
      'La IA y la creación se pagan a Google, a sus precios y sin recargo de Uonify',
    ],
    offers: plans.map(plan => planOfferLd(plan, env)).filter((offer): offer is JsonLdNode => offer !== null),
  };
}

/** Preguntas frecuentes visibles en la página (Google exige que se vean). */
export function faqPageLd(page: SeoPage, env: SeoEnv, faq: readonly SeoQuestion[]): JsonLdNode {
  return {
    '@type': 'FAQPage',
    '@id': `${absoluteUrl(page.path, env)}#faq`,
    inLanguage: SITE.language,
    mainEntity: faq.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/** @graph completo de una página. */
export function pageJsonLd(page: SeoPage, env: SeoEnv): { '@context': string; '@graph': JsonLdNode[] } {
  const graph: Array<JsonLdNode | null> = [
    organizationLd(env),
    websiteLd(env),
    webPageLd(page, env),
    breadcrumbLd(page, env),
    page.software ? softwareApplicationLd(env) : null,
    page.faq?.length ? faqPageLd(page, env, page.faq) : null,
    ...(page.schema ?? []),
  ];
  return { '@context': 'https://schema.org', '@graph': graph.filter((node): node is JsonLdNode => node !== null) };
}
