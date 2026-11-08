/** Solo identificadores de Drive: el servidor verifica propietario, permisos y tipo. */
export function driveFolderId(value: string): string | null {
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{10,200}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password) return null;
    const id = url.pathname.match(/^\/(?:drive\/(?:u\/\d+\/)?folders|folders)\/([A-Za-z0-9_-]{10,200})\/?$/)?.[1];
    return id ?? null;
  } catch { return null; }
}
