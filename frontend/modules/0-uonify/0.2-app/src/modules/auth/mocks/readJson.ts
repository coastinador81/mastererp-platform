/** Cuerpo JSON de la petición simulada, o null si no lo hay o no es JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
