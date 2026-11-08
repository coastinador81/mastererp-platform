/** Fechas relativas a hoy, para que los datos simulados parezcan siempre recientes. */
export function daysAgo(days: number, hour = 10, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function daysFromNow(days: number): string {
  return daysAgo(-days);
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
