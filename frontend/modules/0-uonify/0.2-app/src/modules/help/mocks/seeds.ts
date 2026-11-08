/**
 * Tickets de ejemplo de la simulación: uno respondido y otro cerrado, para que
 * «Mis tickets» enseñe sus estados desde el primer momento.
 */
import type { StoredTicket } from './store';
import { buildTicketNote } from './ticketNote';

const TEAM = 'Equipo de Uonify';
const ago = (now: number, hours: number) => new Date(now - hours * 3_600_000).toISOString();

export function seedTickets(now: number): StoredTicket[] {
  const answered: StoredTicket = {
    id: 'tkt-1041',
    number: 'UON-1041',
    subject: 'No encuentro la categoría de mi producto en Amazon',
    category: 'catalog',
    source: 'uony',
    status: 'answered',
    createdAt: ago(now, 50),
    updatedAt: ago(now, 30),
    lastMessage: '',
    unread: true,
    transcript: [
      { role: 'user', text: 'No me aparece la categoría de mi juego de construcción al buscarla en Atributos.' },
      { role: 'uony', text: 'La categoría de Amazon se elige en la pestaña Atributos, en «Tipo de producto». ¿Quieres que abramos un ticket para que lo revise el equipo?' },
    ],
    messages: [
      {
        id: 'msg-1041-1',
        author: 'customer',
        authorName: 'Cliente',
        body: 'Busco la categoría de mi juego de construcción de madera en Atributos y no aparece. He probado con el nombre de la marca y con «juguete».',
        createdAt: ago(now, 50),
      },
      {
        id: 'msg-1041-2',
        author: 'team',
        authorName: TEAM,
        body: 'Hola. Amazon organiza las categorías por el tipo de producto, no por la marca. Busca por el nombre genérico, por ejemplo «juego de construcción» o «bloques de construcción», y elige la opción de Juguetes y juegos. Si aun así no aparece, dinos el ASIN de un producto parecido y lo miramos contigo.',
        createdAt: ago(now, 30),
      },
    ],
    internalNote: '',
    conversationId: 'conv-seed-1041',
  };
  const closed: StoredTicket = {
    id: 'tkt-1037',
    number: 'UON-1037',
    subject: 'Datos de mi empresa en las facturas',
    category: 'billing',
    source: 'form',
    status: 'closed',
    createdAt: ago(now, 24 * 9),
    updatedAt: ago(now, 24 * 8),
    lastMessage: '',
    unread: false,
    transcript: [],
    messages: [
      {
        id: 'msg-1037-1',
        author: 'customer',
        authorName: 'Cliente',
        body: 'Necesito que las facturas salgan con el nombre fiscal y el NIF de mi empresa, no con mi nombre.',
        createdAt: ago(now, 24 * 9),
      },
      {
        id: 'msg-1037-2',
        author: 'team',
        authorName: TEAM,
        body: 'Hola. Puedes cambiarlo tú en Configuración › Plan › Datos de facturación: las próximas facturas saldrán con esos datos. Si necesitas corregir una factura ya emitida, respóndenos aquí y te enviamos la rectificativa.',
        createdAt: ago(now, 24 * 8.5),
      },
      {
        id: 'msg-1037-3',
        author: 'customer',
        authorName: 'Cliente',
        body: 'Hecho, ya lo he cambiado. Gracias.',
        createdAt: ago(now, 24 * 8),
      },
    ],
    internalNote: '',
    conversationId: null,
  };
  return [answered, closed].map(ticket => ({
    ...ticket,
    lastMessage: ticket.messages[ticket.messages.length - 1].body,
    internalNote: buildTicketNote(ticket, ticket.conversationId),
  }));
}
