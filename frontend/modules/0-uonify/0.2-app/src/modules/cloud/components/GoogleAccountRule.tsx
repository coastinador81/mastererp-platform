/** Permisos adicionales de la misma identidad con la que se accede a Uonify. */
export function GoogleAccountRule({ account }: { account: string }) {
  return <div className="cld-identity-rule">
    <strong>Tu cuenta de Google</strong>
    <p>Conecta Google Cloud y Drive con <b>{account}</b>.</p>
  </div>;
}
