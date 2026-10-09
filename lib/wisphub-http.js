'use strict';

// Lecturas de la API de WispHub con limite de tiempo, reintentos y seguimiento de caidas.
//
// Por que existe: WispHub esta detras de Cloudflare. En sus caidas responde 521
// (servidor caido) o 524 (tiempo agotado, despues de hasta 100 s) con una pagina
// HTML. El 8-oct-2026 hubo dos caidas seguidas de 85 y 30 minutos: 126 de 1.317
// sincronizaciones fallaron, alguna se quedo colgada 4,6 minutos y nadie se entero.
// Sin limite de tiempo un ciclo esperaba lo que tardara Cloudflare; sin reintento,
// un fallo suelto de una pagina descartaba la sincronizacion completa.

const DOWN_STATUS = new Set([500, 502, 503, 520, 521, 523, 525, 526, 527, 530]);
const SLOW_STATUS = new Set([408, 504, 522, 524]);

function wisphubError(message, { code, httpStatus = null, retryable = false, statusCode } = {}) {
  // statusCode: lo que ISP Max responde a quien llamo. Una falla de WispHub es 502;
  // nunca 401, que la web tomaria como sesion vencida y cerraria la sesion del usuario.
  return Object.assign(new Error(message), {
    code,
    httpStatus,
    retryable,
    statusCode: statusCode ?? (httpStatus === 404 ? 404 : 502),
  });
}

/** Traduce una respuesta HTTP fallida de WispHub a un error con codigo y mensaje claro. */
function errorForStatus(status, label = 'WispHub') {
  if (status === 404) return wisphubError(`${label}: No encontrado.`, { code: 'WISPHUB_NOT_FOUND', httpStatus: 404 });
  if (status === 401 || status === 403) return wisphubError(`${label}: WispHub rechazó la clave de la API (${status})`, { code: 'WISPHUB_AUTH', httpStatus: status });
  if (status === 429) return wisphubError(`${label}: WispHub limitó las consultas (429)`, { code: 'WISPHUB_RATE_LIMITED', httpStatus: status, retryable: true });
  if (SLOW_STATUS.has(status)) return wisphubError(`${label}: WispHub no respondió a tiempo (${status})`, { code: 'WISPHUB_TIMEOUT', httpStatus: status, retryable: true });
  if (DOWN_STATUS.has(status) || status >= 500) return wisphubError(`${label}: WispHub está caído (${status})`, { code: 'WISPHUB_DOWN', httpStatus: status, retryable: true });
  return wisphubError(`${label}: WispHub respondió ${status}`, { code: 'WISPHUB_HTTP', httpStatus: status });
}

function errorForFailure(error, timeoutMs, label) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return wisphubError(`${label}: WispHub no respondió en ${Math.round(timeoutMs / 1000)} s`, { code: 'WISPHUB_TIMEOUT', retryable: true });
  }
  const detail = error?.cause?.code || error?.code || error?.message || 'sin detalle';
  return wisphubError(`${label}: no se pudo conectar con WispHub (${detail})`, { code: 'WISPHUB_UNREACHABLE', retryable: true });
}

async function readJson(response, label) {
  try {
    if (typeof response.text !== 'function') return await response.json();
    return JSON.parse(await response.text());
  } catch {
    // Cloudflare a veces entrega su pagina de error con 200: no es una respuesta de la API.
    throw wisphubError(`${label}: WispHub devolvió una página que no es de la API`, { code: 'WISPHUB_INVALID_RESPONSE', httpStatus: response.status || null, retryable: true });
  }
}

/**
 * GET a la API de WispHub. Reintenta solo lo que puede ser pasajero (caida, tiempo
 * agotado, pagina de Cloudflare); un 404 o una clave rechazada se informan al momento.
 */
async function fetchWisphubJson(url, {
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  retries = 2,
  retryDelayMs = 2_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  label = 'WispHub',
} = {}) {
  if (!apiKey) throw wisphubError('WISPHUB_API_KEY no esta configurada', { code: 'WISPHUB_NOT_CONFIGURED', statusCode: 503 });
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(retryDelayMs * 2 ** (attempt - 1));
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = errorForFailure(error, timeoutMs, label);
      continue;
    }
    if (!response.ok) {
      if (typeof response.text === 'function') await response.text().catch(() => '');
      lastError = errorForStatus(response.status, label);
      if (!lastError.retryable) throw lastError;
      continue;
    }
    try {
      return await readJson(response, label);
    } catch (error) {
      lastError = error;
    }
  }
  lastError.attempts = retries + 1;
  throw lastError;
}

/**
 * Lleva la cuenta de las fallas seguidas de WispHub y espacia los intentos mientras
 * esta caido: 1, 2, 4 minutos... hasta `maxDelayMs`. Un exito lo deja como nuevo.
 */
function createOutageTracker({ now = () => Date.now(), baseDelayMs = 60_000, maxDelayMs = 5 * 60_000 } = {}) {
  let failures = 0;
  let since = null;
  let lastError = null;
  let lastCode = null;
  let lastHttpStatus = null;
  let lastFailureAt = null;
  let nextAttemptAt = null;
  let lastSuccessAt = null;

  return {
    success() {
      const outage = failures ? { since, until: now(), failures, lastError } : null;
      failures = 0;
      since = null;
      lastError = null;
      lastCode = null;
      lastHttpStatus = null;
      lastFailureAt = null;
      nextAttemptAt = null;
      lastSuccessAt = now();
      return outage;
    },
    failure(error) {
      failures++;
      since ??= now();
      lastError = String(error?.message || error || 'Error desconocido').slice(0, 300);
      lastCode = error?.code || null;
      lastHttpStatus = error?.httpStatus || null;
      lastFailureAt = now();
      nextAttemptAt = now() + Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - 1));
    },
    shouldWait() {
      return nextAttemptAt != null && now() < nextAttemptAt;
    },
    snapshot() {
      const at = (value) => (value == null ? null : new Date(value).toISOString());
      return {
        state: failures ? 'down' : 'ok',
        consecutiveFailures: failures,
        since: at(since),
        downForMs: since == null ? 0 : now() - since,
        lastError,
        lastCode,
        lastHttpStatus,
        lastFailureAt: at(lastFailureAt),
        nextAttemptAt: at(nextAttemptAt),
        lastSuccessAt: at(lastSuccessAt),
      };
    },
  };
}

module.exports = { fetchWisphubJson, createOutageTracker, errorForStatus, errorForFailure, wisphubError };
