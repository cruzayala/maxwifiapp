const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInvoiceDateWindows,
  fetchWisphubInvoices,
  mapWisphubInvoice,
  mergeInvoicesById,
} = require('../lib/wisphub-invoices');

test('divide el historial en rangos inclusivos de maximo tres meses', () => {
  assert.deepEqual(buildInvoiceDateWindows('2025-11-15', '2026-08-02'), [
    { from: '2025-11-15', to: '2026-02-14' },
    { from: '2026-02-15', to: '2026-05-14' },
    { from: '2026-05-15', to: '2026-08-02' },
  ]);
});

test('pagina facturas conservando el filtro de fecha', async () => {
  const requested = [];
  const pages = [
    { results: [{ id_factura: 1 }], next: 'next' },
    { results: [{ id_factura: 2 }], next: null },
  ];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    return {
      ok: true,
      json: async () => pages.shift(),
    };
  };

  const result = await fetchWisphubInvoices({
    apiKey: 'test',
    from: '2026-01-01',
    to: '2026-03-31',
    fetchImpl,
  });

  assert.deepEqual(result.map((item) => item.id_factura), [1, 2]);
  assert.match(requested[1], /offset=100/);
  assert.match(requested[1], /fecha_emision__range_0=2026-01-01/);
});

test('mapea una factura sin crear una relacion a un cliente inexistente', () => {
  const mapped = mapWisphubInvoice({
    id_factura: 99,
    total: '1250.50',
    cliente: { nombre: 'Cliente historico' },
    articulos: [{ servicio: { id_servicio: 77 } }],
  }, new Set([10]));

  assert.equal(mapped.idFactura, 99);
  assert.equal(mapped.total, 1250.5);
  assert.equal(mapped.clienteIdServicio, null);
  assert.equal(mapped.clienteNombre, 'Cliente historico');
});

test('combina emisiones y pagos sin duplicar facturas', () => {
  const result = mergeInvoicesById(
    [{ id_factura: 1, estado: 'Pendiente' }, { id_factura: 2 }],
    [{ id_factura: 1, estado: 'Pagada' }],
  );
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.id_factura === 1).estado, 'Pagada');
});
