import baseConfig from '../modules/0-uonify/auth-config.json';

/** Vite dev server: same-origin /v1 requests proxied to DEV API Gateway (no browser CORS). */
export function devApiProxy() {
  return {
    '/v1/uonify': {target: baseConfig.apiUrl, changeOrigin: true, secure: true},
    '/v1': {target: baseConfig.adminApiUrl, changeOrigin: true, secure: true},
  };
}