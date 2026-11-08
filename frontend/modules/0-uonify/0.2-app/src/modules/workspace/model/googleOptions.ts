export type GoogleEffort = 'low'|'medium'|'high';
export interface GooglePreferences { model:string; effort:GoogleEffort }
export interface GoogleOptions {
  models:{id:string;label:string;short:string;detail:string;efforts:GoogleEffort[]}[];
  efforts:{id:GoogleEffort;label:string}[];
  preferences:GooglePreferences;
  autoPolicy:string;
}
export function googleEffortLabel(effort: GoogleEffort): string {
  return effort === 'low' ? 'Bajo' : effort === 'high' ? 'Alto' : 'Medio';
}
/** La selección tal como la muestra el selector: «Auto · Medio», «Pro · Alto»… */
export function googleSelectionLabel(data: GoogleOptions, preferences: GooglePreferences): string {
  const model = preferences.model === 'auto' ? 'Auto'
    : data.models.find(item => item.id === preferences.model)?.short ?? 'la IA que tenías';
  return `${model} · ${googleEffortLabel(preferences.effort)}`;
}
/** Auto solo elige las combinaciones de Flash y Flash-Lite incluidas en el catálogo recibido. */
export function googleSelectionEfforts(data: GoogleOptions, model: string): GoogleEffort[] {
  return data.efforts.map(item => item.id).filter(effort => data.models.some(item =>
    (model === 'auto' ? item.id === 'gemini-3.5-flash' || (effort === 'low' && item.id === 'gemini-3.5-flash-lite') : item.id === model)
    && item.efforts.includes(effort)));
}
