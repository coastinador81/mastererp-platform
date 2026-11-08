/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base de la API del backend de Uonify. Por defecto «/api». */
  readonly VITE_API_BASE?: string;
  /** «false» desactiva los datos simulados (MSW). */
  readonly VITE_USE_MOCKS?: string;
  /** «true» solo en la versión de revisión de OpenAI: etiqueta «Simulado». */
  readonly VITE_REVIEW_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
