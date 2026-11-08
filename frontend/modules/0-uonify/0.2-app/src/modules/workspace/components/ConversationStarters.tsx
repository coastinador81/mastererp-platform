import { FileText, Link2, PackagePlus } from 'lucide-react';
import { selectConversationStarter } from '../hooks/starterActions';
import { CONVERSATION_STARTERS } from '../model/conversationStarters';
import '../styles/conversation-starters.css';

const ICONS = [PackagePlus, FileText, Link2];

export function ConversationStarters() {
  return <div className="conversation-starters" role="group" aria-label="Ideas para empezar con Uony">
    {CONVERSATION_STARTERS.map(({ label, prompt }, index) => {
      const StarterIcon = ICONS[index];
      return <button key={label} type="button" onClick={() => selectConversationStarter(prompt)}>
        <StarterIcon size={17} aria-hidden="true" />
        <span>{label}</span>
      </button>;
    })}
  </div>;
}
