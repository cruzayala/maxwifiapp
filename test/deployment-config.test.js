'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBaseUrl, publicBaseUrlFromEnv, publicHostFromEnv } = require('../lib/deployment-config');

test('deployment URL follows explicit configuration before provider metadata', () => {
  assert.equal(publicBaseUrlFromEnv({ PUBLIC_APP_URL: 'https://isp.example.com/app/' }), 'https://isp.example.com');
  assert.equal(publicBaseUrlFromEnv({ RAILWAY_PUBLIC_DOMAIN: 'new-env.up.railway.app' }), 'https://new-env.up.railway.app');
  assert.equal(publicBaseUrlFromEnv({ RENDER_EXTERNAL_URL: 'https://isp.onrender.com/' }), 'https://isp.onrender.com');
});

test('captive host is portable and never invents a deployment domain', () => {
  assert.equal(publicHostFromEnv({ CAPTIVE_HOST: 'portal.example.com' }), 'portal.example.com');
  assert.equal(publicHostFromEnv({ PUBLIC_APP_URL: 'https://isp.example.com' }), 'isp.example.com');
  assert.equal(publicHostFromEnv({}), '');
  assert.throws(() => normalizeBaseUrl('ftp://invalid.example.com'), /HTTP o HTTPS/);
});
