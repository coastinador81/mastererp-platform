import { useEffect, useMemo, useState, type ReactNode } from "react";

type CatalogSection = "products" | "categories" | "attributes" | "brands" | "suppliers";
type Page =
  | "overview"
  | "orders"
  | "orderDetail"
  | "preparation"
  | "routes"
  | "nodes"
  | CatalogSection
  | "catalogDetail"
  | "catalogNew";
type OrderStatus =
  | "Pendiente"
  | "Confirmado"
  | "En preparación"
  | "Listo"
  | "En ruta"
  | "Entregado";

type Order = {
  id: string;
  customer: string;
  email: string;
  products: number;
  total: number;
  payment: string;
  status: OrderStatus;
  date: string;
  address: string;
};

const orders: Order[] = [
  {
    id: "ORD-BB6D5631B1C4",
    customer: "Miguel Estraño",
    email: "miguel.estrano@gmail.com",
    products: 2,
    total: 152,
    payment: "Efectivo",
    status: "Pendiente",
    date: "7 nov, 10:23",
    address: "Av. Providencia 1245, Santiago",
  },
  {
    id: "ORD-2F0CEDB99F2A",
    customer: "Miguel Estraño",
    email: "miguel.estrano@gmail.com",
    products: 3,
    total: 252,
    payment: "Por confirmar",
    status: "Pendiente",
    date: "7 nov, 08:22",
    address: "Los Leones 890, Santiago",
  },
  {
    id: "ORD-8B354B1934E",
    customer: "Andrea Madriz",
    email: "andrea.madriz@email.com",
    products: 1,
    total: 152,
    payment: "Efectivo",
    status: "Confirmado",
    date: "6 nov, 18:29",
    address: "Las Condes 443, Santiago",
  },
  {
    id: "ORD-67B16E9B4289",
    customer: "Andrea Madriz",
    email: "andrea.madriz@email.com",
    products: 1,
    total: 65,
    payment: "Efectivo",
    status: "En preparación",
    date: "5 nov, 19:28",
    address: "Las Condes 443, Santiago",
  },
  {
    id: "ORD-3695A0984CD7",
    customer: "Andrea Madriz",
    email: "andrea.madriz@email.com",
    products: 2,
    total: 52,
    payment: "Efectivo",
    status: "Listo",
    date: "5 nov, 17:48",
    address: "Las Condes 443, Santiago",
  },
  {
    id: "ORD-5A55BB18CB6",
    customer: "Aljadis Vicuña",
    email: "aljadis@email.com",
    products: 1,
    total: 65,
    payment: "Efectivo",
    status: "En ruta",
    date: "5 nov, 16:52",
    address: "Santa Lucía 101, Santiago",
  },
  {
    id: "ORD-A5CEBBC3A8E",
    customer: "Andrea Madriz",
    email: "andrea.madriz@email.com",
    products: 1,
    total: 47,
    payment: "Pago móvil",
    status: "Entregado",
    date: "4 nov, 15:53",
    address: "Las Condes 443, Santiago",
  },
];

const nodes = [
  {
    name: "Nodo Cartanal",
    code: "NODE-QUI-001",
    area: "Quilicura",
    orders: 42,
    capacity: 75,
    coverage: 3,
    fee: 2.5,
  },
  {
    name: "Nodo Dos Lagunas",
    code: "NODE-PAL-001",
    area: "La Florida",
    orders: 31,
    capacity: 60,
    coverage: 5,
    fee: 3,
  },
  {
    name: "Nodo Rosario",
    code: "NODE-ROS-001",
    area: "Rosario",
    orders: 18,
    capacity: 50,
    coverage: 4,
    fee: 2.5,
  },
  {
    name: "Nodo Santa Lucía",
    code: "NODE-LAV-001",
    area: "Santiago Centro",
    orders: 37,
    capacity: 70,
    coverage: 3,
    fee: 2,
  },
];

const routes = [
  {
    id: "#4689D0",
    date: "Hoy, 8 nov",
    driver: "Carlos Méndez",
    stops: 12,
    progress: 8,
    status: "En ruta",
  },
  {
    id: "#F9B972",
    date: "Hoy, 8 nov",
    driver: "Elena Soto",
    stops: 9,
    progress: 9,
    status: "Completada",
  },
  {
    id: "#E9903D",
    date: "Mañana, 9 nov",
    driver: "Por asignar",
    stops: 7,
    progress: 0,
    status: "Planificada",
  },
];

type CatalogRecord = {
  id: string;
  name: string;
  reference: string;
  status: "Activo" | "Borrador";
  meta: string;
  price?: number;
  stock?: number;
  email?: string;
};

const catalogData: Record<CatalogSection, CatalogRecord[]> = {
  products: [
    {
      id: "1",
      name: "Aceite vegetal 1 L",
      reference: "PRD-37F4E3CD81F3",
      status: "Activo",
      meta: "Despensa",
      price: 4.5,
      stock: 48,
    },
    {
      id: "2",
      name: "Aguacate premium",
      reference: "PRD-B119B3F78127",
      status: "Activo",
      meta: "Frutas",
      price: 150,
      stock: 16,
    },
    {
      id: "3",
      name: "Agua mineral 1.5 L",
      reference: "PRD-8EAF5BB4824F",
      status: "Activo",
      meta: "Bebidas",
      price: 1.2,
      stock: 120,
    },
    {
      id: "4",
      name: "Arroz premium 1 kg",
      reference: "PRD-6C98D0A801B0",
      status: "Activo",
      meta: "Despensa",
      price: 3.2,
      stock: 62,
    },
    {
      id: "5",
      name: "Cambur",
      reference: "PRD-11385CD98704",
      status: "Borrador",
      meta: "Frutas",
      price: 45,
      stock: 8,
    },
    {
      id: "6",
      name: "Detergente líquido 1 L",
      reference: "PRD-A7262524670D",
      status: "Activo",
      meta: "Limpieza",
      price: 3.4,
      stock: 35,
    },
  ],
  categories: [
    { id: "c1", name: "Alimentos", reference: "alimentos", status: "Activo", meta: "4 productos" },
    { id: "c2", name: "Bebidas", reference: "bebidas", status: "Activo", meta: "3 productos" },
    { id: "c3", name: "Despensa", reference: "despensa", status: "Activo", meta: "12 productos" },
    { id: "c4", name: "Frutas", reference: "frutas", status: "Activo", meta: "8 productos" },
    { id: "c5", name: "Hogar", reference: "hogar", status: "Activo", meta: "6 productos" },
  ],
  attributes: [
    { id: "a1", name: "Color", reference: "color", status: "Activo", meta: "8 valores" },
    { id: "a2", name: "Tamaño", reference: "tamano", status: "Activo", meta: "5 valores" },
    {
      id: "a3",
      name: "Presentación",
      reference: "presentacion",
      status: "Activo",
      meta: "4 valores",
    },
  ],
  brands: [
    { id: "b1", name: "Casa Verde", reference: "BR-001", status: "Activo", meta: "14 productos" },
    { id: "b2", name: "Origen", reference: "BR-002", status: "Activo", meta: "9 productos" },
    { id: "b3", name: "Natura", reference: "BR-003", status: "Borrador", meta: "3 productos" },
  ],
  suppliers: [
    {
      id: "s1",
      name: "Empaques Río Claro",
      reference: "DEMO-PROV-002",
      status: "Activo",
      meta: "Pago a 30 días",
      email: "proveedor2@example.com",
    },
    {
      id: "s2",
      name: "Limpieza Brisa",
      reference: "DEMO-PROV-004",
      status: "Activo",
      meta: "Pago inmediato",
      email: "contacto@brisa.com",
    },
    {
      id: "s3",
      name: "Logística Ruta Azul",
      reference: "DEMO-PROV-006",
      status: "Activo",
      meta: "Pago a 15 días",
      email: "ventas@rutaazul.com",
    },
    {
      id: "s4",
      name: "Suministros Horizonte",
      reference: "DEMO-PROV-001",
      status: "Activo",
      meta: "Pago a 30 días",
      email: "hola@horizonte.com",
    },
  ],
};

const catalogLabels: Record<
  CatalogSection,
  { label: string; singular: string; subtitle: string; icon: string }
> = {
  products: {
    label: "Productos",
    singular: "producto",
    subtitle: "Ficha comercial, precio e inventario del catálogo.",
    icon: "package",
  },
  categories: {
    label: "Categorías",
    singular: "categoría",
    subtitle: "Organiza la navegación y clasificación de los productos.",
    icon: "box",
  },
  attributes: {
    label: "Atributos",
    singular: "atributo",
    subtitle: "Tipos y opciones reutilizables para tus productos.",
    icon: "clipboard",
  },
  brands: {
    label: "Marcas",
    singular: "marca",
    subtitle: "Identidad comercial de los productos del catálogo.",
    icon: "chart",
  },
  suppliers: {
    label: "Proveedores",
    singular: "proveedor",
    subtitle: "Vínculos de suministro y condiciones comerciales.",
    icon: "users",
  },
};

const catalogNav: { id: CatalogSection; label: string; icon: string }[] = [
  { id: "products", label: "Productos", icon: "package" },
  { id: "categories", label: "Categorías", icon: "box" },
  { id: "attributes", label: "Atributos", icon: "clipboard" },
  { id: "brands", label: "Marcas", icon: "chart" },
  { id: "suppliers", label: "Proveedores", icon: "users" },
];

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "Resumen", icon: "chart" },
  { id: "orders", label: "Pedidos", icon: "package" },
  { id: "preparation", label: "Preparación", icon: "clipboard" },
  { id: "routes", label: "Rutas", icon: "route" },
  { id: "nodes", label: "Nodos", icon: "pin" },
];

function notify(message: string) {
  window.dispatchEvent(new CustomEvent("uonify-notification", { detail: message }));
}

function ToastHost() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(""), 2800);
    };
    window.addEventListener("uonify-notification", show);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("uonify-notification", show);
    };
  }, []);
  return message ? (
    <div className="app-toast">
      <span>
        <Icon name="check" size={15} />
      </span>
      {message}
    </div>
  ) : null;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
      </>
    ),
    package: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4.5 7.5 7.5 4 7.5-4M12 21v-9.5" />
      </>
    ),
    clipboard: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4.5V3h6v1.5M9 10h6m-6 4h6m-6 4h4" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="5" r="2" />
        <path d="M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3H9a3 3 0 0 1-3-3V7a2 2 0 0 1 2-2h8" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    chevron: (
      <>
        <path d="m9 18 6-6-6-6" />
      </>
    ),
    arrow: (
      <>
        <path d="m5 12 14 0m-5-5 5 5-5 5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4 4L19 6" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 14 0m1-16a4 4 0 0 1 0 7m1 3a6 6 0 0 1 4 6" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    box: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 12h8m-4-4v8" />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H5v14h5m4-4 4-3-4-3m4 3H9" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Status({ value }: { value: string }) {
  const tone =
    value === "Entregado" || value === "Completada" || value === "Activo" || value === "Listo"
      ? "success"
      : value === "Pendiente" || value === "Planificada"
        ? "warning"
        : value === "En ruta" || value === "Confirmado"
          ? "info"
          : "violet";
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" />
      {value}
    </span>
  );
}

function Shell({
  page,
  setPage,
  children,
}: {
  page: Page;
  setPage: (page: Page) => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const catalogActive = [
    "products",
    "categories",
    "attributes",
    "brands",
    "suppliers",
    "catalogDetail",
    "catalogNew",
  ].includes(page);
  const go = (target: Page) => {
    setPage(target);
    setMobileOpen(false);
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
          >
            <Icon name="menu" />
          </button>
          <div className="brand-mark">
            <span>U</span>
          </div>
          <div>
            <strong>Uonify</strong>
            <small>Commerce</small>
          </div>
        </div>
        <div className="topbar-context">
          <span className="environment-dot" /> Entorno de desarrollo
        </div>
        <div className="top-actions">
          <button
            className="icon-btn"
            aria-label="Notificaciones"
            onClick={() => notify("No tienes notificaciones pendientes")}
          >
            <Icon name="bell" />
            <i />
          </button>
          <div className="avatar">AM</div>
          <div className="profile-copy">
            <strong>Andrea Madriz</strong>
            <span>Administrador</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setProfileOpen((value) => !value)}
            aria-label="Abrir menú de usuario"
          >
            <Icon name="chevron" size={15} />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <button onClick={() => notify("Perfil de usuario abierto")}>Mi perfil</button>
              <button onClick={() => notify("Preferencias abiertas")}>Preferencias</button>
              <button onClick={() => notify("Sesión protegida: acción demostrativa")}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menú"
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-heading">
          <span>ESPACIO DE TRABAJO</span>
          <button className="icon-btn sidebar-close" onClick={() => setMobileOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-control">
          <button
            className={`workspace-select ${workspaceOpen ? "is-open" : ""}`}
            onClick={() => setWorkspaceOpen((value) => !value)}
          >
            <span className="workspace-icon">
              <Icon name={catalogActive ? "package" : "box"} />
            </span>
            <span>
              <strong>E-commerce</strong>
              <small>{catalogActive ? "Catálogo" : "Operaciones"}</small>
            </span>
            <Icon name="chevron" size={15} />
          </button>
          {workspaceOpen && (
            <div className="workspace-menu">
              <button
                className={!catalogActive ? "active" : ""}
                onClick={() => {
                  go("overview");
                  setWorkspaceOpen(false);
                }}
              >
                <span>
                  <Icon name="chart" />
                </span>
                <div>
                  <strong>Operaciones</strong>
                  <small>Pedidos, preparación y rutas</small>
                </div>
                {!catalogActive && <Icon name="check" size={14} />}
              </button>
              <button
                className={catalogActive ? "active" : ""}
                onClick={() => {
                  go("products");
                  setWorkspaceOpen(false);
                }}
              >
                <span>
                  <Icon name="package" />
                </span>
                <div>
                  <strong>Catálogo</strong>
                  <small>Productos y clasificaciones</small>
                </div>
                {catalogActive && <Icon name="check" size={14} />}
              </button>
            </div>
          )}
        </div>
        <nav>
          <p>OPERACIONES</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={
                page === item.id || (item.id === "orders" && page === "orderDetail") ? "active" : ""
              }
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "orders" && <b>7</b>}
            </button>
          ))}
          <p className="nav-section">CATÁLOGO</p>
          {catalogNav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="help-card">
            <span>¿Necesitas ayuda?</span>
            <p>Consulta la guía de operaciones</p>
            <button onClick={() => notify("Documentación de Operaciones abierta")}>
              Ver documentación <Icon name="arrow" size={14} />
            </button>
          </div>
          <button
            className="logout"
            onClick={() => notify("Cierre de sesión disponible en producción")}
          >
            <Icon name="logout" /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main>{children}</main>
      <ToastHost />
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="breadcrumb">
          E-commerce <span>/</span> {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({
  navigate,
  openOrder,
}: {
  navigate: (page: Page) => void;
  openOrder: (order: Order) => void;
}) {
  const metrics = [
    { label: "Pedidos de hoy", value: "24", meta: "+12% vs. ayer", icon: "package", tone: "blue" },
    {
      label: "Por preparar",
      value: "8",
      meta: "3 con alta prioridad",
      icon: "clipboard",
      tone: "orange",
    },
    { label: "En ruta", value: "15", meta: "2 rutas activas", icon: "truck", tone: "violet" },
    {
      label: "Ventas de hoy",
      value: "USD 2.840",
      meta: "+8,4% vs. ayer",
      icon: "chart",
      tone: "green",
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Buenos días, Andrea"
        subtitle="Este es el estado de tu operación hoy, 8 de noviembre."
        action={
          <button
            className="button secondary"
            onClick={() => notify("Resumen actualizado hace unos segundos")}
          >
            <Icon name="refresh" /> Actualizar
          </button>
        }
      />
      <section className="metric-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className={`metric-icon ${metric.tone}`}>
              <Icon name={metric.icon} />
            </div>
            <div>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.meta}</small>
            </div>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel orders-panel">
          <div className="panel-title">
            <div>
              <h2>Pedidos recientes</h2>
              <p>Últimos movimientos de la tienda</p>
            </div>
            <button className="text-button" onClick={() => navigate("orders")}>
              Ver todos <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="mini-order-list">
            {orders.slice(0, 5).map((order) => (
              <button key={order.id} onClick={() => openOrder(order)}>
                <span className="order-symbol">
                  <Icon name="package" />
                </span>
                <span className="mini-order-main">
                  <strong>{order.id.replace("ORD-", "#")}</strong>
                  <small>
                    {order.customer} · {order.products} productos
                  </small>
                </span>
                <strong className="mini-total">USD {order.total.toFixed(2)}</strong>
                <Status value={order.status} />
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-title">
            <div>
              <h2>Flujo de pedidos</h2>
              <p>Distribución actual</p>
            </div>
            <button className="icon-btn" onClick={() => notify("Opciones del gráfico disponibles")}>
              <Icon name="more" />
            </button>
          </div>
          <div className="donut-wrap">
            <div className="donut">
              <div>
                <strong>47</strong>
                <span>pedidos</span>
              </div>
            </div>
            <div className="legend">
              <span>
                <i className="legend-blue" />
                Confirmados <b>18</b>
              </span>
              <span>
                <i className="legend-violet" />
                En preparación <b>8</b>
              </span>
              <span>
                <i className="legend-orange" />
                En ruta <b>15</b>
              </span>
              <span>
                <i className="legend-green" />
                Entregados <b>6</b>
              </span>
            </div>
          </div>
          <button className="button full secondary" onClick={() => navigate("preparation")}>
            Gestionar preparación
          </button>
        </article>
      </section>
      <section className="panel quick-panel">
        <div className="panel-title">
          <div>
            <h2>Accesos rápidos</h2>
            <p>Continúa con las tareas más frecuentes</p>
          </div>
        </div>
        <div className="quick-grid">
          {[
            [
              "orders",
              "package",
              "Gestionar pedidos",
              "Revisa y actualiza el estado de cada pedido",
            ],
            [
              "preparation",
              "clipboard",
              "Preparar productos",
              "Organiza los pedidos antes del despacho",
            ],
            ["routes", "route", "Planificar rutas", "Consulta y organiza las entregas"],
            ["nodes", "pin", "Configurar nodos", "Administra ubicaciones y capacidades"],
          ].map((item) => (
            <button key={item[0]} onClick={() => navigate(item[0] as Page)}>
              <span>
                <Icon name={item[1]} />
              </span>
              <div>
                <strong>{item[2]}</strong>
                <small>{item[3]}</small>
              </div>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Orders({ openOrder }: { openOrder: (order: Order) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState("");
  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        const matchSearch = `${order.id} ${order.customer} ${order.email}`
          .toLowerCase()
          .includes(search.toLowerCase());
        return matchSearch && (filter === "Todos" || order.status === filter);
      }),
    [search, filter],
  );
  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Pedidos"
        subtitle="Consulta y gestiona el ciclo operativo de cada pedido."
        action={
          <button
            className="button primary"
            onClick={() => notify("Pedidos sincronizados correctamente")}
          >
            <Icon name="refresh" /> Sincronizar pedidos
          </button>
        }
      />
      <section className="panel table-panel">
        <div className="panel-title orders-title">
          <div>
            <h2>
              Todos los pedidos <span>{orders.length}</span>
            </h2>
            <p>Información actualizada hace 2 minutos</p>
          </div>
        </div>
        <div className="filters">
          <label className="search-field">
            <Icon name="search" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por pedido, cliente o correo..."
            />
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrar por estado"
          >
            {[
              "Todos",
              "Pendiente",
              "Confirmado",
              "En preparación",
              "Listo",
              "En ruta",
              "Entregado",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <button
            className={`button secondary ${showMoreFilters ? "is-active" : ""}`}
            onClick={() => setShowMoreFilters((value) => !value)}
          >
            Más filtros
          </button>
        </div>
        {showMoreFilters && (
          <div className="advanced-filters">
            <label>
              Desde <input type="date" />
            </label>
            <label>
              Hasta <input type="date" />
            </label>
            <label>
              Pago
              <select>
                <option>Todos</option>
                <option>Efectivo</option>
                <option>Pago móvil</option>
              </select>
            </label>
            <button
              className="button secondary"
              onClick={() => {
                setSearch("");
                setFilter("Todos");
                setShowMoreFilters(false);
                notify("Filtros restablecidos");
              }}
            >
              Limpiar
            </button>
          </div>
        )}
        <div className="bulk-bar">
          <span>{selectedIds.length} seleccionados</span>
          <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value)}>
            <option value="">Acciones agrupadas</option>
            <option value="Confirmado">Marcar como confirmado</option>
            <option value="En preparación">Enviar a preparación</option>
            <option value="export">Exportar selección</option>
          </select>
          <button
            className="button secondary"
            disabled={!selectedIds.length || !bulkAction}
            onClick={() => {
              notify(
                bulkAction === "export"
                  ? `${selectedIds.length} pedidos exportados`
                  : `${selectedIds.length} pedidos actualizados a ${bulkAction}`,
              );
              setSelectedIds([]);
              setBulkAction("");
            }}
          >
            Aplicar
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={selectedIds.length === filtered.length && filtered.length > 0}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? filtered.map((order) => order.id) : [])
                    }
                  />
                </th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Productos</th>
                <th>Pago</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} onClick={() => openOrder(order)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${order.id}`}
                      checked={selectedIds.includes(order.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, order.id]
                            : current.filter((id) => id !== order.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{order.id}</strong>
                  </td>
                  <td>
                    <div className="customer-cell">
                      <span>
                        {order.customer
                          .split(" ")
                          .map((x) => x[0])
                          .join("")}
                      </span>
                      <div>
                        <strong>{order.customer}</strong>
                        <small>{order.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {order.products} {order.products === 1 ? "producto" : "productos"}
                  </td>
                  <td>{order.payment}</td>
                  <td>
                    <strong>USD {order.total.toFixed(2)}</strong>
                  </td>
                  <td>
                    <Status value={order.status} />
                  </td>
                  <td>{order.date}</td>
                  <td>
                    <button className="icon-btn" aria-label="Ver pedido">
                      <Icon name="chevron" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="empty-state">
            <Icon name="search" size={28} />
            <strong>No encontramos pedidos</strong>
            <p>Prueba con otro término o estado.</p>
          </div>
        )}
        <div className="table-footer">
          <span>
            Mostrando {filtered.length} de {orders.length} pedidos
          </span>
          <div>
            <button onClick={() => notify("Esta es la primera página")}>Anterior</button>
            <button className="current">1</button>
            <button onClick={() => notify("No hay más pedidos para mostrar")}>Siguiente</button>
          </div>
        </div>
      </section>
    </>
  );
}

function OrderDetail({ order, back }: { order: Order; back: () => void }) {
  const steps = ["Pendiente", "Confirmado", "En preparación", "Listo", "En ruta", "Entregado"];
  const [status, setStatus] = useState(order.status);
  const [note, setNote] = useState("");
  const current = steps.indexOf(status);
  return (
    <>
      <button className="back-link" onClick={back}>
        <Icon name="arrow" size={15} /> Volver a pedidos
      </button>
      <PageHeader
        eyebrow={`Pedidos / ${order.id}`}
        title={`Pedido ${order.id}`}
        subtitle={`Creado el ${order.date} · Última actualización hace 2 minutos`}
        action={
          <div className="header-actions">
            <button className="button secondary" onClick={() => window.print()}>
              Imprimir
            </button>
            <button className="button secondary" onClick={() => notify("Factura descargada")}>
              Descargar factura
            </button>
          </div>
        }
      />
      <div className="order-detail-layout">
        <div className="order-detail-main">
          <section className="panel">
            <div className="order-detail-heading">
              <div>
                <span>ESTADO ACTUAL</span>
                <Status value={status} />
              </div>
              <strong>USD {order.total.toFixed(2)}</strong>
            </div>
            <div className="stepper full-stepper">
              {steps.map((step, i) => (
                <div className={i <= current ? "complete" : ""} key={step}>
                  <span>{i < current ? <Icon name="check" size={13} /> : i + 1}</span>
                  <small>{step}</small>
                </div>
              ))}
            </div>
            {current < 5 && (
              <div className="order-status-action">
                <div>
                  <strong>Siguiente etapa: {steps[current + 1]}</strong>
                  <small>La actualización quedará registrada en el historial del pedido.</small>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setStatus(steps[current + 1] as OrderStatus);
                    notify(`Pedido actualizado a ${steps[current + 1]}`);
                  }}
                >
                  Marcar como {steps[current + 1]}
                </button>
              </div>
            )}
          </section>
          <section className="panel order-products-card">
            <div className="panel-title">
              <div>
                <h2>Productos del pedido</h2>
                <p>{order.products} unidades en total</p>
              </div>
            </div>
            {Array.from({ length: Math.min(order.products, 3) }).map((_, i) => (
              <div className="product-line" key={i}>
                <div className="product-image">
                  <Icon name="package" />
                </div>
                <div>
                  <strong>{i === 0 ? "Auriculares Bluetooth Pro" : "Cargador USB-C 30W"}</strong>
                  <small>SKU-00{124 + i} · Cantidad: 1</small>
                </div>
                <span>USD {(order.total / order.products).toFixed(2)}</span>
                <strong>USD {(order.total / order.products).toFixed(2)}</strong>
              </div>
            ))}
            <div className="detail-section totals embedded-totals">
              <span>
                Subtotal <b>USD {(order.total - 2).toFixed(2)}</b>
              </span>
              <span>
                Entrega <b>USD 2.00</b>
              </span>
              <span>
                Total <b>USD {order.total.toFixed(2)}</b>
              </span>
            </div>
          </section>
          <section className="panel order-notes">
            <div className="panel-title">
              <div>
                <h2>Notas internas</h2>
                <p>Solo visibles para el equipo de operaciones</p>
              </div>
            </div>
            <div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Escribe una nota sobre este pedido..."
              />
              <button
                className="button primary"
                disabled={!note.trim()}
                onClick={() => {
                  notify("Nota guardada en el historial");
                  setNote("");
                }}
              >
                Añadir nota
              </button>
            </div>
          </section>
        </div>
        <aside className="order-detail-side">
          <section className="panel detail-side-card">
            <div className="panel-title">
              <h2>Cliente</h2>
            </div>
            <div className="side-card-content">
              <div className="customer-profile">
                <span>
                  {order.customer
                    .split(" ")
                    .map((name) => name[0])
                    .join("")}
                </span>
                <div>
                  <strong>{order.customer}</strong>
                  <small>Cliente desde 2024 · 8 pedidos</small>
                </div>
              </div>
              <dl>
                <dt>Correo</dt>
                <dd>{order.email}</dd>
                <dt>Teléfono</dt>
                <dd>+56 9 4321 8765</dd>
              </dl>
              <button
                className="button secondary full"
                onClick={() => notify("Ficha del cliente abierta")}
              >
                Ver ficha del cliente
              </button>
            </div>
          </section>
          <section className="panel detail-side-card">
            <div className="panel-title">
              <h2>Entrega</h2>
            </div>
            <div className="side-card-content">
              <dl>
                <dt>Dirección</dt>
                <dd>{order.address}</dd>
                <dt>Método</dt>
                <dd>Entrega estándar</dd>
                <dt>Nodo asignado</dt>
                <dd>Nodo Cartanal</dd>
              </dl>
              <button className="button secondary full" onClick={() => notify("Dirección copiada")}>
                Copiar dirección
              </button>
            </div>
          </section>
          <section className="panel detail-side-card">
            <div className="panel-title">
              <h2>Pago</h2>
            </div>
            <div className="side-card-content">
              <dl>
                <dt>Método</dt>
                <dd>{order.payment}</dd>
                <dt>Estado</dt>
                <dd>Pago confirmado</dd>
              </dl>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Preparation({ openOrder }: { openOrder: (order: Order) => void }) {
  const [view, setView] = useState<"list" | "board">("list");
  const prepOrders = orders.filter((o) =>
    ["Confirmado", "En preparación", "Listo"].includes(o.status),
  );
  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Preparación"
        subtitle="Organiza los productos y déjalos listos para despacho."
        action={
          <button
            className="button secondary"
            onClick={() => notify("Cola de preparación actualizada")}
          >
            <Icon name="refresh" /> Actualizar
          </button>
        }
      />
      <div className="summary-strip">
        <div>
          <span className="summary-icon orange">
            <Icon name="clipboard" />
          </span>
          <p>
            <strong>8</strong>
            <small>Por preparar</small>
          </p>
        </div>
        <div>
          <span className="summary-icon violet">
            <Icon name="package" />
          </span>
          <p>
            <strong>14</strong>
            <small>Productos pendientes</small>
          </p>
        </div>
        <div>
          <span className="summary-icon green">
            <Icon name="check" />
          </span>
          <p>
            <strong>5</strong>
            <small>Listos para despacho</small>
          </p>
        </div>
      </div>
      <section className="panel kanban-panel">
        <div className="panel-title">
          <div>
            <h2>Cola de preparación</h2>
            <p>Pedidos confirmados por orden de llegada</p>
          </div>
          <div className="view-toggle">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
              Lista
            </button>
            <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
              Tablero
            </button>
          </div>
        </div>
        <div className={`prep-list ${view === "board" ? "prep-board" : ""}`}>
          {prepOrders.map((order, i) => (
            <article key={order.id}>
              <div className="prep-order">
                <span className="priority">{i + 1}</span>
                <div>
                  <strong>{order.id}</strong>
                  <small>
                    {order.customer} · Recibido {order.date}
                  </small>
                </div>
              </div>
              <div className="prep-products">
                <strong>{order.products}</strong>
                <span>{order.products === 1 ? "producto" : "productos"}</span>
              </div>
              <Status value={order.status} />
              <div className="progress">
                <span>
                  <i
                    style={{
                      width: `${order.status === "Listo" ? 100 : order.status === "En preparación" ? 55 : 0}%`,
                    }}
                  />
                </span>
                <small>
                  {order.status === "Listo"
                    ? "100%"
                    : order.status === "En preparación"
                      ? "55%"
                      : "0%"}
                </small>
              </div>
              <button className="button secondary" onClick={() => openOrder(order)}>
                {order.status === "Listo" ? "Ver detalle" : "Preparar"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Routes() {
  const [routeItems, setRouteItems] = useState(routes);
  const [route, setRoute] = useState(routes[0]);
  const [showStops, setShowStops] = useState(false);
  const createRoute = () => {
    const newRoute = {
      id: `#NUEV${routeItems.length + 1}`,
      date: "Mañana, 9 nov",
      driver: "Por asignar",
      stops: 0,
      progress: 0,
      status: "Planificada",
    };
    setRouteItems((current) => [newRoute, ...current]);
    setRoute(newRoute);
    notify("Nueva ruta creada como borrador");
  };
  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Rutas"
        subtitle="Planifica y supervisa las entregas de tus pedidos."
        action={
          <button className="button primary" onClick={createRoute}>
            <Icon name="route" /> Crear ruta
          </button>
        }
      />
      <div className="routes-layout">
        <section className="panel route-list-panel">
          <div className="panel-title">
            <div>
              <h2>Rutas de hoy</h2>
              <p>3 rutas · 28 paradas</p>
            </div>
            <button
              className="icon-btn"
              onClick={() => {
                setRouteItems((current) => [...current].reverse());
                notify("Orden de rutas actualizado");
              }}
            >
              <Icon name="more" />
            </button>
          </div>
          <div className="route-list">
            {routeItems.map((item) => (
              <button
                className={route.id === item.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setRoute(item);
                  setShowStops(false);
                }}
              >
                <span className="route-icon">
                  <Icon name="route" />
                </span>
                <span className="route-copy">
                  <strong>Ruta {item.id}</strong>
                  <small>
                    {item.date} · {item.driver}
                  </small>
                  <span>
                    <i style={{ width: `${(item.progress / item.stops) * 100}%` }} />
                  </span>
                </span>
                <div>
                  <Status value={item.status} />
                  <small>
                    {item.progress}/{item.stops} entregas
                  </small>
                </div>
              </button>
            ))}
          </div>
        </section>
        <section className="panel route-detail">
          <div className="map-placeholder">
            <div className="map-road road-a" />
            <div className="map-road road-b" />
            <div className="map-road road-c" />
            <span className="map-pin one">1</span>
            <span className="map-pin two">2</span>
            <span className="map-pin three">3</span>
            <div className="map-label">Santiago</div>
          </div>
          <div className="route-info">
            <div>
              <span>RUTA SELECCIONADA</span>
              <h2>Ruta {route.id}</h2>
              <p>
                <Icon name="users" size={16} /> {route.driver} <b>·</b> {route.stops} paradas
              </p>
            </div>
            <Status value={route.status} />
          </div>
          <div className="route-stats">
            <div>
              <span>Progreso</span>
              <strong>
                {route.progress} de {route.stops}
              </strong>
            </div>
            <div>
              <span>Distancia</span>
              <strong>24,8 km</strong>
            </div>
            <div>
              <span>Tiempo estimado</span>
              <strong>2 h 15 min</strong>
            </div>
          </div>
          {showStops && (
            <div className="route-stops">
              {[1, 2, 3].map((stop) => (
                <div key={stop}>
                  <span>{stop}</span>
                  <div>
                    <strong>
                      Parada {stop} · Pedido #9D23E{stop}
                    </strong>
                    <small>{stop === 1 ? "Entregado" : "Pendiente de entrega"}</small>
                  </div>
                  <Status value={stop === 1 ? "Entregado" : "Pendiente"} />
                </div>
              ))}
            </div>
          )}
          <button
            className="button full primary"
            onClick={() => {
              setShowStops((value) => !value);
              notify(showStops ? "Detalle de ruta contraído" : "Paradas de la ruta cargadas");
            }}
          >
            {showStops ? "Ocultar detalle" : "Ver detalle de la ruta"}
          </button>
        </section>
      </div>
    </>
  );
}

function Nodes() {
  const [nodeItems, setNodeItems] = useState(nodes);
  const [selected, setSelected] = useState(nodes[0]);
  const [saved, setSaved] = useState(false);
  const addNode = () => {
    const newNode = {
      name: `Nuevo nodo ${nodeItems.length + 1}`,
      code: `NODE-NUE-00${nodeItems.length + 1}`,
      area: "Sin ubicación",
      orders: 0,
      capacity: 50,
      coverage: 3,
      fee: 2.5,
    };
    setNodeItems((current) => [...current, newNode]);
    setSelected(newNode);
    setSaved(false);
    notify("Nuevo nodo creado. Completa su configuración");
  };
  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Nodos"
        subtitle="Configura las ubicaciones que atienden tus pedidos."
        action={
          <button className="button primary" onClick={addNode}>
            <Icon name="pin" /> Añadir nodo
          </button>
        }
      />
      <div className="nodes-layout">
        <section className="panel nodes-list">
          <div className="panel-title">
            <div>
              <h2>Ubicaciones operativas</h2>
              <p>{nodeItems.length} nodos activos</p>
            </div>
          </div>
          {nodeItems.map((node) => (
            <button
              key={node.code}
              className={selected.code === node.code ? "active" : ""}
              onClick={() => {
                setSelected(node);
                setSaved(false);
              }}
            >
              <span className="node-map-icon">
                <Icon name="pin" />
              </span>
              <span>
                <strong>{node.name}</strong>
                <small>
                  {node.area} · {node.code}
                </small>
              </span>
              <div>
                <Status value="Activo" />
                <small>{node.orders} pedidos hoy</small>
              </div>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </section>
        <section className="panel node-form">
          <div className="panel-title">
            <div>
              <span className="overline">CONFIGURACIÓN DEL NODO</span>
              <h2>{selected.name}</h2>
              <p>{selected.code}</p>
            </div>
            <Status value="Activo" />
          </div>
          <div className="capacity-card">
            <span>
              <Icon name="chart" />
            </span>
            <div>
              <small>Capacidad utilizada hoy</small>
              <strong>
                {selected.orders} de {selected.capacity} pedidos
              </strong>
              <div>
                <i style={{ width: `${(selected.orders / selected.capacity) * 100}%` }} />
              </div>
            </div>
            <b>{Math.round((selected.orders / selected.capacity) * 100)}%</b>
          </div>
          <form
            key={selected.code}
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(true);
              notify("Configuración del nodo guardada");
            }}
          >
            <label className="switch-row">
              <span>
                <strong>Acepta pedidos</strong>
                <small>Permite asignar nuevos pedidos a esta ubicación.</small>
              </span>
              <input type="checkbox" defaultChecked />
              <i />
            </label>
            <div className="form-grid">
              <label>
                <span>Cobertura de entrega</span>
                <div className="input-suffix">
                  <input type="number" defaultValue={selected.coverage} />
                  <small>km</small>
                </div>
              </label>
              <label>
                <span>Capacidad diaria</span>
                <div className="input-suffix">
                  <input type="number" defaultValue={selected.capacity} />
                  <small>pedidos</small>
                </div>
              </label>
              <label>
                <span>Pedido mínimo</span>
                <div className="input-prefix">
                  <small>USD</small>
                  <input type="number" defaultValue={5} />
                </div>
              </label>
              <label>
                <span>Tarifa de entrega</span>
                <div className="input-prefix">
                  <small>USD</small>
                  <input type="number" defaultValue={selected.fee} step="0.5" />
                </div>
              </label>
            </div>
            <div className="form-actions">
              {saved && (
                <span className="saved-message">
                  <Icon name="check" /> Cambios guardados
                </span>
              )}
              <button
                type="reset"
                className="button secondary"
                onClick={() => {
                  setSaved(false);
                  notify("Cambios descartados");
                }}
              >
                Descartar
              </button>
              <button className="button primary">Guardar cambios</button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}

function CatalogList({
  section,
  openRecord,
  createRecord,
}: {
  section: CatalogSection;
  openRecord: (record: CatalogRecord) => void;
  createRecord: () => void;
}) {
  const config = catalogLabels[section];
  const records = catalogData[section];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Todos");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = records.filter(
    (record) =>
      `${record.name} ${record.reference}`.toLowerCase().includes(search.toLowerCase()) &&
      (status === "Todos" || record.status === status),
  );
  return (
    <>
      <PageHeader
        eyebrow="Gestión de Catálogo"
        title={config.label}
        subtitle={config.subtitle}
        action={
          <button className="button primary" onClick={createRecord}>
            <Icon name="box" /> Nuevo {config.singular}
          </button>
        }
      />
      <section className="catalog-metrics">
        <article>
          <span>
            <Icon name={config.icon} />
          </span>
          <div>
            <strong>{records.length}</strong>
            <small>{config.label} totales</small>
          </div>
        </article>
        <article>
          <span className="green">
            <Icon name="check" />
          </span>
          <div>
            <strong>{records.filter((item) => item.status === "Activo").length}</strong>
            <small>Activos y publicados</small>
          </div>
        </article>
        <article>
          <span className="orange">
            <Icon name="clipboard" />
          </span>
          <div>
            <strong>{records.filter((item) => item.status === "Borrador").length}</strong>
            <small>Pendientes de revisión</small>
          </div>
        </article>
      </section>
      <section className="panel table-panel catalog-table">
        <div className="catalog-toolbar">
          <label className="search-field">
            <Icon name="search" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Buscar ${config.label.toLowerCase()}...`}
            />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>Todos</option>
            <option>Activo</option>
            <option>Borrador</option>
          </select>
          <button
            className="button secondary"
            onClick={() => notify(`${config.label} actualizados`)}
          >
            <Icon name="refresh" /> Actualizar
          </button>
        </div>
        {selected.length > 0 && (
          <div className="catalog-selection">
            <span>{selected.length} seleccionados</span>
            <button
              onClick={() => {
                notify(`${selected.length} registros publicados`);
                setSelected([]);
              }}
            >
              Publicar
            </button>
            <button onClick={() => notify("Selección exportada")}>Exportar</button>
            <button onClick={() => setSelected([])}>Cancelar</button>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selected.length === filtered.length && filtered.length > 0}
                    onChange={(event) =>
                      setSelected(event.target.checked ? filtered.map((item) => item.id) : [])
                    }
                  />
                </th>
                <th>{section === "products" ? "Producto" : "Nombre"}</th>
                <th>Referencia</th>
                <th>{section === "products" ? "Categoría" : "Información"}</th>
                {section === "products" && (
                  <>
                    <th>Precio</th>
                    <th>Stock</th>
                  </>
                )}
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr key={record.id} onClick={() => openRecord(record)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.includes(record.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, record.id]
                            : current.filter((id) => id !== record.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="catalog-name">
                      <span>
                        <Icon name={config.icon} />
                      </span>
                      <div>
                        <strong>{record.name}</strong>
                        <small>ID {record.id.toUpperCase()}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <code>{record.reference}</code>
                  </td>
                  <td>{record.meta}</td>
                  {section === "products" && (
                    <>
                      <td>
                        <strong>USD {record.price?.toFixed(2)}</strong>
                      </td>
                      <td>
                        <span className={(record.stock ?? 0) < 10 ? "stock-low" : ""}>
                          {record.stock} uds.
                        </span>
                      </td>
                    </>
                  )}
                  <td>
                    <Status value={record.status} />
                  </td>
                  <td>
                    <button
                      className="button secondary compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRecord(record);
                      }}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="empty-state">
            <Icon name={config.icon} size={30} />
            <strong>No hay resultados</strong>
            <p>Ajusta los filtros o crea un nuevo registro.</p>
            <button className="button primary" onClick={createRecord}>
              Crear {config.singular}
            </button>
          </div>
        )}
        <div className="table-footer">
          <span>
            Mostrando {filtered.length} de {records.length} registros
          </span>
          <div>
            <button onClick={() => notify("Primera página")}>Anterior</button>
            <button className="current">1</button>
            <button onClick={() => notify("Última página")}>Siguiente</button>
          </div>
        </div>
      </section>
    </>
  );
}

function CatalogEditor({
  section,
  record,
  isNew,
  back,
}: {
  section: CatalogSection;
  record?: CatalogRecord;
  isNew?: boolean;
  back: () => void;
}) {
  const config = catalogLabels[section];
  const [activeTab, setActiveTab] = useState("general");
  const [enabled, setEnabled] = useState(record?.status !== "Borrador");
  const [name, setName] = useState(record?.name ?? "");
  const [reference, setReference] = useState(record?.reference ?? "");
  return (
    <>
      <button className="back-link" onClick={back}>
        <Icon name="arrow" size={15} /> Volver a {config.label.toLowerCase()}
      </button>
      <PageHeader
        eyebrow={`Catálogo / ${config.label}`}
        title={isNew ? `Nuevo ${config.singular}` : (record?.name ?? config.singular)}
        subtitle={
          isNew
            ? `Completa la información para crear el ${config.singular}.`
            : `Edita la ficha y configuración de este ${config.singular}.`
        }
        action={
          <div className="header-actions">
            <button className="button secondary" onClick={back}>
              Cancelar
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (!name.trim()) {
                  notify("El nombre es obligatorio");
                  return;
                }
                notify(`${isNew ? "Registro creado" : "Cambios guardados"} correctamente`);
              }}
            >
              Guardar
            </button>
          </div>
        }
      />
      <div className="catalog-editor-layout">
        <section className="panel catalog-editor-main">
          <div className="editor-tabs">
            {[
              "general",
              "organización",
              ...(section === "products" ? ["precio e inventario", "imágenes"] : []),
            ].map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? "active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          {activeTab === "general" && (
            <div className="editor-section">
              <div className="section-heading">
                <span>
                  <Icon name={config.icon} />
                </span>
                <div>
                  <h2>Información general</h2>
                  <p>Datos principales visibles en el back office y la tienda.</p>
                </div>
              </div>
              <div className="editor-form">
                <label className="span-2">
                  <span>Nombre *</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={`Nombre del ${config.singular}`}
                  />
                </label>
                <label>
                  <span>Referencia</span>
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Se genera automáticamente"
                  />
                </label>
                <label>
                  <span>Estado</span>
                  <select
                    value={enabled ? "Activo" : "Borrador"}
                    onChange={(event) => setEnabled(event.target.value === "Activo")}
                  >
                    <option>Activo</option>
                    <option>Borrador</option>
                  </select>
                </label>
                <label className="span-2">
                  <span>Descripción</span>
                  <textarea
                    defaultValue={
                      isNew
                        ? ""
                        : `${record?.name} forma parte del catálogo comercial de E-commerce.`
                    }
                    placeholder="Añade una descripción clara..."
                  />
                </label>
                {section === "suppliers" && (
                  <>
                    <label>
                      <span>Correo de contacto</span>
                      <input
                        type="email"
                        defaultValue={record?.email}
                        placeholder="contacto@proveedor.com"
                      />
                    </label>
                    <label>
                      <span>Teléfono</span>
                      <input placeholder="+56 9 0000 0000" />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}
          {activeTab === "organización" && (
            <div className="editor-section">
              <div className="section-heading">
                <span>
                  <Icon name="box" />
                </span>
                <div>
                  <h2>Organización</h2>
                  <p>Clasificación y orden dentro del catálogo.</p>
                </div>
              </div>
              <div className="editor-form">
                <label>
                  <span>Categoría principal</span>
                  <select>
                    <option>Despensa</option>
                    <option>Alimentos</option>
                    <option>Bebidas</option>
                  </select>
                </label>
                <label>
                  <span>Orden</span>
                  <input type="number" defaultValue="0" />
                </label>
                <label className="span-2">
                  <span>Etiquetas</span>
                  <input placeholder="Añade etiquetas separadas por comas" />
                </label>
              </div>
            </div>
          )}
          {activeTab === "precio e inventario" && (
            <div className="editor-section">
              <div className="section-heading">
                <span>
                  <Icon name="chart" />
                </span>
                <div>
                  <h2>Precio e inventario</h2>
                  <p>Información comercial y disponibilidad del producto.</p>
                </div>
              </div>
              <div className="editor-form">
                <label>
                  <span>Precio de venta</span>
                  <div className="input-prefix">
                    <small>USD</small>
                    <input type="number" defaultValue={record?.price ?? 0} />
                  </div>
                </label>
                <label>
                  <span>Stock disponible</span>
                  <input type="number" defaultValue={record?.stock ?? 0} />
                </label>
                <label>
                  <span>Stock mínimo</span>
                  <input type="number" defaultValue="5" />
                </label>
                <label>
                  <span>Impuesto</span>
                  <select>
                    <option>IVA estándar</option>
                    <option>Exento</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {activeTab === "imágenes" && (
            <div className="editor-section">
              <div className="section-heading">
                <span>
                  <Icon name="package" />
                </span>
                <div>
                  <h2>Imágenes del producto</h2>
                  <p>Sube imágenes en formato JPG, PNG o WebP.</p>
                </div>
              </div>
              <button
                className="upload-zone"
                onClick={() => notify("Selector de archivos abierto")}
              >
                <span>
                  <Icon name="box" />
                </span>
                <strong>Arrastra imágenes aquí o haz clic para buscar</strong>
                <small>Máximo 5 MB por archivo</small>
              </button>
            </div>
          )}
          <div className="editor-footer">
            <button className="button secondary" onClick={back}>
              Cancelar
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (!name.trim()) {
                  notify("El nombre es obligatorio");
                  return;
                }
                notify(`${isNew ? "Registro creado" : "Cambios guardados"} correctamente`);
              }}
            >
              Guardar {config.singular}
            </button>
          </div>
        </section>
        <aside className="catalog-editor-side">
          <section className="panel publish-card">
            <div className="panel-title">
              <h2>Publicación</h2>
            </div>
            <div>
              <label className="switch-row">
                <span>
                  <strong>Visible en el catálogo</strong>
                  <small>Los clientes podrán encontrar este registro.</small>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <i />
              </label>
              <dl>
                <dt>Estado</dt>
                <dd>
                  <Status value={enabled ? "Activo" : "Borrador"} />
                </dd>
                <dt>Creado</dt>
                <dd>8 nov. 2026</dd>
                <dt>Actualizado</dt>
                <dd>Hace 2 minutos</dd>
              </dl>
            </div>
          </section>
          {!isNew && (
            <section className="panel danger-card">
              <div>
                <strong>Eliminar {config.singular}</strong>
                <p>Esta acción no se puede deshacer.</p>
                <button onClick={() => notify("Se solicitó confirmación para eliminar")}>
                  Eliminar
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [selectedOrder, setSelectedOrder] = useState<Order>(orders[0]);
  const [catalogSection, setCatalogSection] = useState<CatalogSection>("products");
  const [catalogRecord, setCatalogRecord] = useState<CatalogRecord>(catalogData.products[0]);
  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setPage("orderDetail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openCatalogRecord = (section: CatalogSection, record: CatalogRecord) => {
    setCatalogSection(section);
    setCatalogRecord(record);
    setPage("catalogDetail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const createCatalogRecord = (section: CatalogSection) => {
    setCatalogSection(section);
    setPage("catalogNew");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <Shell page={page} setPage={setPage}>
      <div className="page-container">
        {page === "overview" && <Overview navigate={setPage} openOrder={openOrder} />}
        {page === "orders" && <Orders openOrder={openOrder} />}
        {page === "orderDetail" && (
          <OrderDetail order={selectedOrder} back={() => setPage("orders")} />
        )}
        {page === "preparation" && <Preparation openOrder={openOrder} />}
        {page === "routes" && <Routes />}
        {page === "nodes" && <Nodes />}
        {catalogNav.map(
          (item) =>
            page === item.id && (
              <CatalogList
                key={item.id}
                section={item.id}
                openRecord={(record) => openCatalogRecord(item.id, record)}
                createRecord={() => createCatalogRecord(item.id)}
              />
            ),
        )}
        {page === "catalogDetail" && (
          <CatalogEditor
            section={catalogSection}
            record={catalogRecord}
            back={() => setPage(catalogSection)}
          />
        )}
        {page === "catalogNew" && (
          <CatalogEditor section={catalogSection} isNew back={() => setPage(catalogSection)} />
        )}
      </div>
    </Shell>
  );
}
