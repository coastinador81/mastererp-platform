import productosCss from '../../styles/pages/productos.css?inline';
import comoFuncionaCss from '../../styles/pages/como-funciona.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PUBLIC_VIEWS } from '../../model/views';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { useDemoToast } from '../common/useDemoToast';
import { SiteFooter } from '../footer/SiteFooter';
import { PublishAndClose, ReviewStoryHow } from './HowClosing';
import { HowHero } from './HowHero';
import { AskStory, ConnectStory, CoordinateStory } from './HowStories';
import { JourneyDemo } from './JourneyDemo';

const SHEETS = viewSheets(productosCss, comoFuncionaCss);
const STAGES: ReadonlyArray<{ id: string; number: string; label: string }> = [
  { id: 'pedir', number: '01', label: 'Pedir' },
  { id: 'conectar', number: '02', label: 'Conectar' },
  { id: 'coordinar', number: '03', label: 'Coordinar' },
  { id: 'revisar', number: '04', label: 'Revisar' },
  { id: 'publicar', number: '05', label: 'Publicar' },
];

/** Cómo funciona Uonify (`/como-funciona`): de una petición a un resultado. */
export function ComoFuncionaPage() {
  const [toast, showToast] = useDemoToast('how-toast');
  return (
    <PublicView view={PUBLIC_VIEWS['como-funciona']} sheets={SHEETS}>
      <PageHeader current="como-funciona" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <HowHero />
        <nav className="how-index wrap" aria-label="Etapas del recorrido">
          {STAGES.map(stage => <a key={stage.id} href={`#${stage.id}`}><span>{stage.number}</span>{stage.label}</a>)}
        </nav>
        <JourneyDemo />
        <AskStory />
        <ConnectStory />
        <CoordinateStory />
        <ReviewStoryHow />
        <PublishAndClose showToast={showToast} />
      </main>
      <SiteFooter />
      {toast}
    </PublicView>
  );
}
