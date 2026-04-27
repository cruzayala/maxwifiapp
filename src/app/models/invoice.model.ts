export interface Invoice {
  id_factura: number;
  folio: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  estado: string;
  tipo: number;
  zona: { id: number; nombre: string };
  sub_total: number;
  descuento: number;
  saldo: number;
  saldo_nuevo: number;
  impuestos_total: number;
  total_cobrado: number;
  total: number;
  comprobante_pago: string | null;
  referencia: string;
  total_pasarela: number;
  retencion_porcentaje: number;
  retenciones_total: number;
  forma_pago: { id: number; nombre: string };
  cajero: { id: number; nombre: string } | null;
  cliente: {
    usuario: string;
    nombre: string;
    email: string;
    cedula: string;
    direccion: string;
    localidad: string;
    telefono: string;
    rfc: string;
  };
  articulos: InvoiceArticle[];
}

export interface InvoiceArticle {
  id: number;
  cantidad: number;
  descripcion: string;
  precio: string;
  servicio: { id_servicio: number };
}

export interface InvoiceResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Invoice[];
}
