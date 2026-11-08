import { registerIcon } from '@/shared/ui';

/** Recursos de marca del acceso (copiados del prototipo en public/assets). */
export const BRAND = {
  wordmark: '/assets/brands/uonify-wordmark-3d.webp',
  isotype: '/assets/brands/uonify-isotipo-3d.webp',
  overlay: '/assets/brands/uonify-overlay.webp',
  chatgpt: '/assets/brands/chatgpt.svg',
  character: '/assets/product-icons/catalogo.png',
} as const;

// Sobre del acceso por correo (lucide «mail»).
registerIcon('auth-mail', '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>');

/**
 * «G» de Google con sus colores oficiales, sin alterar (normas de marca de
 * Google para el botón de acceso). Decorativa: el botón ya dice «Google».
 */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="uon-auth-google-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
