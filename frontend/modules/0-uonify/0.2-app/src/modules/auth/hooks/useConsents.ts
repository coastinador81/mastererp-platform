import { useMemo } from 'react';
import { CONSENT_DOCUMENTS, formatConsentDate } from '../model/legal';
import type { ChatGPTPlanStatus, ConsentId } from '../model/types';
import { useAuthSession } from './useSession';

/** Aceptación para Configuración › Privacidad y legal (requisito de la revisión de OpenAI). */
export interface AcceptedConsent {
  id: ConsentId;
  title: string;
  version: string;
  acceptedAt: string;
  /** «27/09/2026». */
  acceptedOn: string;
  href?: string;
  /** Es la versión vigente del documento. */
  current: boolean;
}

/** Documentos aceptados por la cuenta, con su versión y su fecha (más recientes primero). */
export function useConsents(): AcceptedConsent[] {
  const { consents } = useAuthSession();
  return useMemo(
    () =>
      [...consents]
        .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
        .map(consent => {
          const doc = CONSENT_DOCUMENTS[consent.id];
          return {
            id: consent.id,
            title: doc.title,
            version: consent.version,
            acceptedAt: consent.acceptedAt,
            acceptedOn: formatConsentDate(consent.acceptedAt),
            href: doc.href,
            current: consent.version === doc.version,
          };
        }),
    [consents],
  );
}

/** Estado del permiso del plan de ChatGPT (Configuración › Conexiones y Uso). */
export function useChatGPTPlan(): ChatGPTPlanStatus {
  return useAuthSession().chatgptPlan;
}
