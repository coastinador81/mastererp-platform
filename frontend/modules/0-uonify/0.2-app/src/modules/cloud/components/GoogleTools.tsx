import { useState } from 'react';
import { DriveOnboarding } from '@/modules/drive';
import { GoogleCloudConnection } from './GoogleCloudConnection';
export function GoogleTools({ account, onContinue }: { account: string; onContinue: () => void | Promise<void> }) {
  const [tab, setTab] = useState<'cloud' | 'drive'>('drive');
  return <><div className="cld-tool-tabs" aria-label="Tus herramientas de Google"><button aria-pressed={tab === 'cloud'} onClick={() => setTab('cloud')}>IA con Google</button><button aria-pressed={tab === 'drive'} onClick={() => setTab('drive')}>Google Drive · opcional</button></div>{tab === 'cloud' ? <GoogleCloudConnection account={account} /> : <DriveOnboarding account={account} onContinue={onContinue} />}</>;
}
