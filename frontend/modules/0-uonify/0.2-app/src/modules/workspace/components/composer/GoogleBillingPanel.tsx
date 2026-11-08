import { InformationDisclosure } from '@/shared/ui';
import { useGoogleBilling } from '../../hooks/useGoogleBilling';
import { googleBillingCalendarDate, googleBillingDate, googleBillingPeriod, googleMoney, googleReportPeriod,
  verifiedAutomaticSource, verifiedGoogleCredit } from '../../model/googleBilling';

export function GoogleBillingPanel({ active }: { active: boolean }) {
  const billing = useGoogleBilling(active);
  const data = billing.snapshot;
  const automatic = verifiedAutomaticSource(data?.source ?? null);
  const credit = verifiedGoogleCredit(data);
  const consumption = data ? googleMoney(data.consumptionEUR, data.currency) : null;
  const period = data ? (automatic ? googleReportPeriod : googleBillingPeriod)(data.periodStart, data.periodEnd) : null;
  const observed = data ? googleBillingDate(data.observedAt) : null;
  const expires = data ? googleBillingCalendarDate(data.creditExpiresOn) ?? googleBillingDate(data.creditExpiresAt) : null;
  const checked = billing.response?.billingVerified ? googleBillingDate(billing.response.checkedAt) : null;
  const sync = billing.syncState;
  const setup = sync?.status === 'needs_setup' || sync?.reason === 'service_unconfirmed';
  const canSync = !!sync && sync.canSync && !billing.loading && !billing.syncing;
  const syncMessage = billing.syncError ?? (billing.syncing ? 'Consultando el consumo que publica Google…' : sync?.message);
  const noRecords = sync?.status === 'no_records';
  const requestedPeriod = noRecords ? googleReportPeriod(sync.periodStart, sync.periodEnd) : null;
  const reportChecked = noRecords ? googleBillingDate(sync.checkedAt) : null;
  return <div className="composer-google-billing">
    {data ? <>
      <dl><div><dt>{credit?.stale ? 'Último crédito comprobado' : 'Crédito disponible'}</dt><dd className="composer-google-credit">{credit?.amount ?? 'Sin datos'}</dd></div>
        <div><dt>{automatic ? 'Consumo del proyecto' : 'Consumo'}</dt><dd>{consumption ?? 'Sin datos'}</dd></div></dl>
      {period && <p className="composer-google-period">{period}</p>}
      <p className="composer-google-observed">{automatic ? 'Consulta de consumo actualizada el ' : 'Datos comprobados en Google el '}<time dateTime={data.observedAt!}>{observed}</time>.</p>
      {automatic && credit && <p className="composer-google-observed">Crédito comprobado el <time dateTime={credit.observedAt}>{googleBillingDate(credit.observedAt)}</time>.</p>}
      {data.status === 'stale' && <p className="composer-google-stale">Son los últimos datos comprobados; pueden haber cambiado.</p>}
      {syncMessage && (sync?.status !== 'ready' || billing.syncError) && <p className="composer-context-state" role="status">{syncMessage}</p>}
      <InformationDisclosure label="Origen de estos datos">
        {automatic ? <>
          <p>Consumo del proyecto conectado obtenido mediante la API oficial de Google, antes de aplicar créditos y descuentos.
            Google puede tardar más de 24 horas en publicar el coste; la fecha indica cuándo lo consultamos.</p>
          <p>El saldo promocional restante no está incluido en esta fuente. «Sin datos» no significa que no tengas crédito.</p>
          <p><a href={data.source!.url} target="_blank" rel="noopener noreferrer">Cómo publica Google estos costes ↗</a></p>
        </> : <>
          <p>Importes observados en la consola de Google Cloud. Esta consulta muestra una comprobación guardada;
            el saldo no se sincroniza automáticamente con Google.</p>
          <p>El crédito y el consumo corresponden a toda tu cuenta de facturación de Google, incluidos sus demás proyectos.
            El consumo se muestra antes de aplicar créditos y descuentos.</p>
        </>}
        {data.netConsumptionEUR !== null && data.netConsumptionEUR !== undefined && <p>Importe después de créditos y descuentos: {googleMoney(data.netConsumptionEUR, data.currency) ?? 'Sin datos'}.</p>}
        <p>Cuenta: {data.accountEmail}. Proyecto vinculado: {data.projectName ?? 'Proyecto seleccionado'}.</p>
        <p>Registrados en Uonify el {googleBillingDate(data.recordedAt)}.</p>
        {expires && <p>Vencimiento del crédito: {expires}.</p>}
        {automatic && credit && <p>El crédito corresponde a toda la cuenta de facturación y conserva su propia fecha de comprobación.</p>}
        {automatic && credit?.stale && <p>El crédito es la última comprobación guardada y puede haber cambiado.</p>}
        {billing.consoleLinks && automatic && <p><a href={billing.consoleLinks.credits} target="_blank" rel="noopener noreferrer">Consultar el crédito en Google ↗</a></p>}
        {billing.consoleLinks && <p><a href={billing.consoleLinks.reports} target="_blank" rel="noopener noreferrer">Consultar el consumo en Google ↗</a></p>}
      </InformationDisclosure>
    </> : <>
      <p className="composer-context-state" role="status">{syncMessage ?? billing.message}</p>
      {checked && !noRecords && <p className="composer-google-observed">Conexión comprobada el <time dateTime={billing.response!.checkedAt}>{checked}</time>.</p>}
      {billing.consoleLinks && !sync ? <a className="composer-context-retry" href={billing.consoleLinks.credits} target="_blank" rel="noopener noreferrer">Consultar en Google ↗</a>
        : !billing.loading && billing.canRetry && <button type="button" className="composer-context-retry" onClick={() => void billing.retry()}>Reintentar consulta</button>}
    </>}
    {noRecords && <>
      {requestedPeriod && <p className="composer-google-period">{requestedPeriod}</p>}
      {reportChecked && <p className="composer-google-observed">Consulta de consumo comprobada el <time dateTime={sync.checkedAt!}>{reportChecked}</time>.</p>}
      {!data && <InformationDisclosure label="Origen de estos datos">
        <p>Consultamos el coste bruto del proyecto conectado, antes de aplicar créditos y descuentos.
          Google puede tardar más de 24 horas en publicar el coste. Sin registros no significa consumo cero.</p>
        <p>La fecha indica cuándo consultamos el informe. El saldo promocional restante no está incluido en esta fuente.</p>
        {verifiedAutomaticSource(sync.source) && <p><a href={sync.source.url} target="_blank" rel="noopener noreferrer">Cómo publica Google estos costes ↗</a></p>}
      </InformationDisclosure>}
    </>}
    {sync && (setup || sync.status === 'error' || sync.status === 'ready' || sync.status === 'no_records' || billing.syncError) &&
      <button type="button" className="composer-context-retry" disabled={!canSync}
        onClick={() => void billing.sync(setup)}>{billing.syncing ? 'Consultando…' : setup ? 'Activar consulta' : 'Actualizar consumo'}</button>}
    {!sync && billing.syncError && <button type="button" className="composer-context-retry" disabled={billing.syncing}
      onClick={() => void billing.sync(false)}>Reintentar consulta</button>}
    {sync && billing.consoleLinks && !data && <a className="composer-context-retry" href={billing.consoleLinks.credits} target="_blank" rel="noopener noreferrer">Consultar el crédito en Google ↗</a>}
  </div>;
}
