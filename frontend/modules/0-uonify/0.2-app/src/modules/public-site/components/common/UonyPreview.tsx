import { ProductDemoPreview } from '@/modules/catalog';
import { InterfaceCapture, type InterfaceView } from './InterfaceCapture';

/** La conversación fotografiada y el mismo visor de ficha usado por el cliente. */
export function UonyPreview({ view = 'uony-revision', preview = false }: { view?: InterfaceView; preview?: boolean }) {
  return <div className="uony-preview">
    <InterfaceCapture view={view} />
    {preview && <div className="interface-preview-action"><ProductDemoPreview /></div>}
  </div>;
}
