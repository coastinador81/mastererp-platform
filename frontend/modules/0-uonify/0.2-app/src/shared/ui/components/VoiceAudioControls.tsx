interface Props {
  talking: boolean;
  dictating: boolean;
  microphoneMuted: boolean;
  speakerMuted: boolean;
  dictate(): void;
  toggleMicrophone(): void;
  toggleSpeaker(): void;
}

/** Los mismos controles de audio en la portada y en el espacio. */
export function VoiceAudioControls(props: Props) {
  const micLabel = props.talking
    ? props.microphoneMuted ? 'Activar micrófono' : 'Silenciar micrófono'
    : props.dictating ? 'Detener dictado' : 'Dictar';
  const speakerLabel = props.speakerMuted ? 'Activar altavoz de Uony' : 'Silenciar altavoz de Uony';
  return <>
    <button type="button" className="composer-voice-button" data-composer-dictate=""
      aria-label={micLabel} data-tooltip={micLabel} title={micLabel}
      aria-pressed={props.talking ? props.microphoneMuted : props.dictating}
      onClick={props.talking ? props.toggleMicrophone : props.dictate}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
        {props.talking && props.microphoneMuted && <path d="m3 3 18 18" />}
      </svg>
    </button>
    {props.talking && <button type="button" className="composer-voice-button" data-composer-speaker=""
      aria-label={speakerLabel} data-tooltip={speakerLabel} data-tooltip-align="end" title={speakerLabel}
      aria-pressed={props.speakerMuted} onClick={props.toggleSpeaker}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 4 6 8H3v8h3l5 4V4Z" />
        {props.speakerMuted ? <path d="m16 9 6 6m0-6-6 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}
      </svg>
    </button>}
  </>;
}
