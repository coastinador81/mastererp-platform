import { VoiceTalkButton as SharedVoiceTalkButton } from '@/shared/ui';
import { useSession } from './authBridge';

interface Props { active: boolean; listen(): void }
export function VoiceTalkButton(props: Props) {
  const { status, user } = useSession();
  const account = status === 'ready' ? user?.email.trim().toLowerCase() || '' : status === 'signed-out' ? 'visitor' : '';
  return <SharedVoiceTalkButton account={account} {...props} />;
}
