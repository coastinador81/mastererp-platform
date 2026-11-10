/** Fallo de una lectura del ERP con su código HTTP, para elegir el texto de la pantalla del equipo. */
export class MastererpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = 'MastererpError';
  }
}
