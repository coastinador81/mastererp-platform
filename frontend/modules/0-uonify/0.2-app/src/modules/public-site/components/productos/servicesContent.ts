/** Servicios en desarrollo de «Cada necesidad, una herramienta con carácter» (#herramientas). */
export interface ServiceCard {
  id: string;
  /** Tarjeta ancha (texto + imagen + palabras clave) o alta (en columna). */
  layout: 'wide' | 'tall';
  /** Clases de color del PROTO (mint, ice, cloud, nexus-service). */
  tone?: string;
  title: string;
  promise: readonly [string, string];
  copy: string;
  details: string;
  image: string;
  alt: string;
  keywords?: readonly [string, string, string];
  /** Ancla adicional para enlaces antiguos (#ventas, #proveedores). */
  alias?: string;
}

export const SERVICES: readonly ServiceCard[] = [
  {
    id: 'erp', layout: 'wide', title: 'ERP',
    promise: ['Que las piezas de tu negocio', 'encajen.'],
    copy: 'Clientes, proveedores, pedidos, compras e inventario: un contexto común para gestionar el día a día.',
    details: 'Relacionar la información comercial y operativa. Consultar un pedido con sus productos y documentos, y conectar la compra con el inventario y el proveedor.',
    image: 'erp', alt: 'ERP, un personaje construido con signos matemáticos', keywords: ['Pedidos', 'Compras', 'Inventario'],
  },
  {
    id: 'analitica', layout: 'tall', title: 'Analítica',
    promise: ['Los datos cuentan.', 'Entiende qué te dicen.'],
    copy: 'Reúne indicadores y comparativas para interpretar cambios y decidir con más contexto.',
    details: 'Una lectura conjunta de tendencias, resultados y evolución del negocio. Pasar del dato aislado a preguntas útiles para tu siguiente decisión.',
    image: 'analitica', alt: 'Analítica, un personaje de gráficos y barras', alias: 'ventas',
  },
  {
    id: 'auditoria', layout: 'tall', tone: 'mint', title: 'Captura y auditoría',
    promise: ['Lo importante,', 'sin pasar por alto.'],
    copy: 'Captura información de origen y revisa lo que falta, lo que encaja y lo que merece otra mirada.',
    details: 'Un espacio especializado para contrastar datos, mantener el origen de la información y señalar incidencias antes de incorporarlas al trabajo.',
    image: 'auditoria', alt: 'Captura y auditoría, el personaje inspector',
  },
  {
    id: 'agentes', layout: 'wide', tone: 'ice', title: 'Agentes',
    promise: ['Un equipo de IA.', 'Una dirección: la tuya.'],
    copy: 'Especialistas digitales para acompañar tareas, compartir contexto y ayudarte a avanzar entre herramientas.',
    details: 'Coordinar tareas especializadas y reunir sus resultados en el mismo espacio. Tú defines el objetivo y revisas las propuestas antes de actuar.',
    image: 'hive', alt: 'Agentes, personaje modular azul y aqua', keywords: ['Contexto', 'Colaboración', 'Tu control'],
  },
  {
    id: 'academy', layout: 'wide', tone: 'cloud', title: 'Academy',
    promise: ['Aprender también', 'es hacer.'],
    copy: 'Un lugar para entender las herramientas y desarrollar criterio mientras trabajas con ellas.',
    details: 'Recorridos de aprendizaje y contenidos prácticos que conectan el conocimiento con situaciones de trabajo. Avanza a tu ritmo y lleva lo aprendido a tu día a día.',
    image: 'academy', alt: 'Academy, El curioso con gafas cuadradas y lápiz', keywords: ['Aprende', 'Practica', 'Avanza'],
  },
  {
    id: 'logistica', layout: 'tall', title: 'Logística',
    promise: ['Cada producto', 'tiene un camino.'],
    copy: 'Un contexto para seguir movimientos, entregas y etapas de la operación.',
    details: 'Relacionar el recorrido del producto con las necesidades de la operación. Comprender en qué punto está cada movimiento y cuál es su siguiente etapa.',
    image: 'logistica', alt: 'Logística, una furgoneta sonriente',
  },
  {
    id: 'fabrica', layout: 'tall', tone: 'mint', title: 'Fábrica y proveedores',
    promise: ['Las buenas ideas', 'necesitan buenos aliados.'],
    copy: 'Conecta lo que quieres crear con especificaciones, proveedores y decisiones de aprovisionamiento.',
    details: 'Reunir requisitos de producto, información del proveedor y contexto de compra para preparar mejor cada decisión y dar continuidad al proyecto.',
    image: 'fabrica', alt: 'Fábrica y proveedores, un fabricante sonriente', alias: 'proveedores',
  },
  {
    id: 'nexus', layout: 'wide', tone: 'nexus-service', title: 'Nexus',
    promise: ['Lo que conectas,', 'cobra sentido.'],
    copy: 'Un punto de unión entre herramientas y sistemas para que la información pueda seguir su recorrido.',
    details: 'Conexiones e intercambios entre sistemas a través de sus interfaces. Menos información aislada, más continuidad entre las piezas de tu trabajo.',
    image: 'nexus', alt: 'Nexus, dos eslabones abiertos que representan una conexión', keywords: ['Sistemas', 'Conexiones', 'Continuidad'],
  },
];
