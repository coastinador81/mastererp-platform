import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { PATHS } from '../../model/views';
import { PreferencesDialog } from './PreferencesDialog';

/** Pie de la portada con los enlaces de descubrir, legales y «Preferencias». */
export function HomeFooter() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState('');
  const openPreferences = () => {
    setStatus('');
    dialogRef.current?.showModal?.();
  };
  return (
    <>
      <footer className="footer">
        <nav aria-label="Descubrir Uonify">
          <Link to={PATHS.paraEmpresas}>Para equipos y marcas</Link>
          <Link to={PATHS.comoFunciona}>Cómo funciona Uonify</Link>
        </nav>
        <nav aria-label="Legal y preferencias">
          <Link to={PATHS.privacidad}>Privacidad</Link>
          <Link to={PATHS.terminos}>Condiciones</Link>
          <button type="button" id="preferences-trigger" aria-haspopup="dialog" aria-controls="preferences-dialog" onClick={openPreferences}>Preferencias</button>
        </nav>
      </footer>
      <PreferencesDialog ref={dialogRef} status={status} onStatus={setStatus} />
    </>
  );
}
