'use strict';
const { InvoiceRenderer } = require('./invoice-renderer');

function invoiceDocument(invoice, company, paper = 'A4') {
  if (!['A4', '58mm', '80mm'].includes(paper)) throw Object.assign(new Error('Formato de papel invalido'), { status: 400 });
  const document = {
    id_factura: invoice.idFactura, folio: invoice.folio, estado: invoice.estado,
    fecha_emision: invoice.fechaEmision, fecha_vencimiento: invoice.fechaVencimiento, fecha_pago: invoice.fechaPago,
    sub_total: invoice.subTotal, descuento: invoice.descuento, impuestos_total: invoice.impuestosTotal,
    total: invoice.total, total_cobrado: invoice.totalCobrado, saldo: invoice.saldo, saldo_nuevo: invoice.saldoNuevo,
    referencia: invoice.referencia, comprobante_pago: invoice.comprobantePago,
    forma_pago: invoice.formaPagoNombre ? { nombre: invoice.formaPagoNombre } : null,
    cajero: invoice.cajeroNombre ? { nombre: invoice.cajeroNombre } : null,
    cliente: { nombre: invoice.clienteNombre, usuario: invoice.clienteUsuario, cedula: invoice.clienteCedula,
      telefono: invoice.clienteTelefono, direccion: invoice.clienteDireccion, email: invoice.clienteEmail, rfc: invoice.clienteRfc },
    articulos: (invoice.articles || []).map((a) => ({ id: a.id, cantidad: a.cantidad, descripcion: a.descripcion, precio: a.precio, servicio: { id_servicio: a.idServicio } })),
  };
  const renderer = new InvoiceRenderer({ companyName: company.companyName || 'MaxWiFi RD', companySlogan: company.companySlogan || '', companyPhone: company.companyPhone || '', companyAddress: company.companyAddress || '', rnc: company.rnc || '' }, paper === 'A4' ? '80mm' : paper);
  return { html: paper === 'A4' ? renderer.generateInvoiceHTML(document, false) : renderer.generateReceiptHTML(document, false),
    fileName: `ISP-Max-factura-${invoice.idFactura}-${paper}.html`, paper, sourceUpdatedAt: invoice.syncedAt };
}
module.exports = { invoiceDocument };
