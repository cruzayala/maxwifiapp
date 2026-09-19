'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { invoiceDocument } = require('../lib/mobile-documents');
test('generated invoice renderer matches the shared TypeScript source', () => {
  execFileSync(process.execPath, ['scripts/build-invoice-renderer.js', '--check']);
});
test('invoice renderer escapes untrusted company/client/article text', () => {
  const result = invoiceDocument({ idFactura: 1, clienteNombre: '<script>alert(1)</script>', estado: 'Pendiente', total: 100,
    totalCobrado: 40, saldo: 60, subTotal: 100, articles: [{ cantidad: 1, descripcion: '<img onerror=evil>', precio: '100' }] }, { companyName: '<b>ISP</b>' });
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.equal(result.html.includes('<script>'), false);
  assert.equal(result.html.includes('<img'), false);
  assert.ok(result.html.includes('60.00'));
});
test('calendar invoice dates never shift to the previous day across timezones', () => {
  const script = `const { invoiceDocument } = require('./lib/mobile-documents');
    process.stdout.write(invoiceDocument({idFactura:1, total:100, fechaEmision:'2026-09-01', fechaVencimiento:'2026-09-06', fechaPago:'2026-09-02'}, {}).html);`;
  for (const TZ of ['UTC', 'America/Santo_Domingo', 'America/Los_Angeles']) {
    const html = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.ok(html.includes('01/09/2026'), TZ);
    assert.ok(html.includes('06/09/2026'), TZ);
    assert.ok(html.includes('02/09/2026'), TZ);
    assert.equal(html.includes('31/08/2026'), false, TZ);
  }
});
