import { describe, expect, it } from 'vitest';
import { voiceInput } from '../model/voiceCommands';
describe('Turnos de voz', () => {
  it('acumula instrucciones sin enviarlas hasta listo', () => {
    const first = voiceInput('Espera a que diga listo', '', false);
    expect(first.action).toBe('wait');
    expect(first.text).toBe('');
    const second = voiceInput('Quiero subir el juego', first.text, first.hold);
    expect(second.action).toBe('wait');
    const third = voiceInput('a Amazon', second.text, second.hold);
    const last = voiceInput('listo', third.text, third.hold);
    expect(last).toEqual({ text: 'Quiero subir el juego a Amazon', hold: false, action: 'send' });
  });
  it('para conserva el borrador sin enviar', () => {
    expect(voiceInput('para', 'Mi petición', true)).toEqual({ text: 'Mi petición', hold: false, action: 'stop' });
  });
  it('una petición breve se envía al terminar el turno', () => {
    expect(voiceInput('Quiero subir un producto a Amazon', '', false).action).toBe('send');
  });
});
