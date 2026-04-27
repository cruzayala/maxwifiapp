export interface Ticket {
  id: number;
  id_ticket: number;
  asunto: string;
  cliente: string;
  id_servicio: number;
  estado: string;
  prioridad: string;
  fecha_creacion: string;
  fecha_actualizacion: string;
  asignado: string;
  descripcion: string;
}

export interface TicketResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Ticket[];
}

export interface TicketSubject {
  id: number;
  nombre: string;
}
