'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotDto } = require('../lib/tr069-control');

test('snapshot masks secret TR-069 parameter values by path', () => {
  const { parameters } = snapshotDto({ parameters: [
    { path: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', value: 'clave-wifi' },
    { path: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey', value: 'x' },
    { path: 'InternetGatewayDevice.ManagementServer.Password', value: 'acs' },
    { path: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', value: 'Casa' },
  ] });
  assert.deepEqual(parameters.map((row) => row.value), ['***', '***', '***', 'Casa']);
});
