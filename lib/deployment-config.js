'use strict';

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_APP_URL debe usar HTTP o HTTPS');
  return url.origin;
}

function publicBaseUrlFromEnv(env = process.env) {
  if (env.PUBLIC_APP_URL) return normalizeBaseUrl(env.PUBLIC_APP_URL);
  if (env.RAILWAY_PUBLIC_DOMAIN) return normalizeBaseUrl(`https://${env.RAILWAY_PUBLIC_DOMAIN}`);
  if (env.RENDER_EXTERNAL_URL) return normalizeBaseUrl(env.RENDER_EXTERNAL_URL);
  return '';
}

function publicHostFromEnv(env = process.env) {
  const explicit = String(env.CAPTIVE_HOST || '').trim();
  if (explicit) return explicit.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const baseUrl = publicBaseUrlFromEnv(env);
  return baseUrl ? new URL(baseUrl).hostname : '';
}

module.exports = { normalizeBaseUrl, publicBaseUrlFromEnv, publicHostFromEnv };
