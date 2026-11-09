/** Qué supone apoyar a Uonify (decisión del dueño: partners voluntarios, voto simbólico). */
export function SupportPerks() {
  return (
    <ul className="bil-bullets">
      <li>Te conviertes en partner voluntario de Uonify.</li>
      <li>Tienes un voto simbólico en la hoja de ruta: lo tenemos en cuenta, pero no es vinculante.</li>
      <li>Recibes una factura cada mes y puedes dejarlo cuando quieras.</li>
    </ul>
  );
}

/** Nota legal obligatoria junto al pago de «Apoya a Uonify». */
export function SupportLegalNote() {
  return (
    <p className="bil-fine">
      Uonify es una marca de ETHICS CLOUD &amp; SECURITY SERVICES LLC, una sociedad de responsabilidad limitada de Florida (EE.&nbsp;UU.) con ánimo de lucro. Este pago es una suscripción de apoyo, no una donación, y no es deducible como
      donativo. Recibirás una factura con los impuestos que correspondan. Puedes cancelarla cuando quieras desde Configuración › Plan y
      facturación.
    </p>
  );
}
