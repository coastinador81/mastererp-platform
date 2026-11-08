/**
 * Único punto de contacto con el módulo auth: sus diálogos (acceso, alta, cuenta
 * y bienvenida) se pintan una vez en el espacio; el menú de cuenta enseña su
 * resumen y cierra la sesión; el compositor envía solo con
 * la sesión lista y recoge la petición escrita antes de entrar. Aislado aquí para
 * que las pruebas del espacio lo sustituyan sin cargar auth.
 */
export { AuthDialogs, requirePrompt, signOut, takePendingPrompt, useAccountSummary, useSession } from '@/modules/auth';
