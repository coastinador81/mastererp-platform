import { buttonClass, Icon } from '@/shared/ui';

const SUBJECT = encodeURIComponent('Plan Personalizado de Uonify');

/** Plan Personalizado: se acuerda con ventas (hola@uonify.com). */
export function SalesBody() {
  return (
    <div className="bil-sales">
      <p>Para varias marcas, equipos grandes o requisitos propios de seguridad y soporte preparamos un plan a tu medida.</p>
      <p>Cuéntanos cuántas personas sois, cuántos productos y canales gestionáis y qué necesitas.</p>
      <a className={buttonClass('primary')} href={`mailto:hola@uonify.com?subject=${SUBJECT}`}>
        <Icon name="send" size={16} />
        Escribir a hola@uonify.com
      </a>
    </div>
  );
}
