// -----------------------------------------------------------------------------
// Minimal HTTP(S) transport for the Omada controller.
//
// node:https rather than fetch: the controller ships a self-signed certificate,
// and accepting it (on the user's explicit choice) needs `rejectUnauthorized`,
// which the built-in fetch does not expose without an extra dependency.
//
// The transport never logs: the callers decide what is worth a line, and a
// request URL or body may carry an identifier the logs must not show.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

/** TLS errors that mean "a certificate Node does not trust", the self-signed case. */
const CERTIFICATE_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
]);

/** A failure reaching the controller (network, TLS, timeout, not JSON). */
export class OmadaTransportError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, certificate?: boolean }} [details]
   */
  constructor(message, { code, certificate = false } = {}) {
    super(message);
    this.name = 'OmadaTransportError';
    this.code = code;
    // True when the controller certificate was refused: the user can accept it.
    this.certificate = certificate;
  }
}

/**
 * Normalize the controller address typed by the user: scheme added when
 * missing (https, like the controller), no trailing slash.
 * @param {string} url
 */
export function normalizeBaseUrl(url) {
  let base = String(url ?? '').trim();
  if (base === '') {
    return '';
  }
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  return base.replace(/\/+$/, '');
}

/**
 * Send one request and parse the JSON answer.
 * @param {object} options
 * @param {string} options.url absolute URL
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {unknown} [options.body] serialized as JSON
 * @param {boolean} [options.insecure] accept a certificate Node does not trust
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any, contentType: string }>}
 */
export function requestJson({
  url,
  method = 'GET',
  headers = {},
  body,
  insecure = false,
  timeoutMs = 10000,
}) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (payload) {
    requestHeaders['Content-Type'] = 'application/json';
    requestHeaders['Content-Length'] = String(payload.length);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method,
        headers: requestHeaders,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          // A controller answer is a few hundred KB at most: a bigger one is
          // not the API (a firmware file, a web page served by mistake).
          if (size > 20 * 1024 * 1024) {
            req.destroy(new OmadaTransportError('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const contentType = String(res.headers['content-type'] ?? '');
          let json;
          if (text !== '') {
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json, contentType });
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new OmadaTransportError('the controller did not answer in time', { code: 'TIMEOUT' }),
      );
    });
    req.on('error', (err) => {
      if (err instanceof OmadaTransportError) {
        reject(err);
        return;
      }
      const certificate = CERTIFICATE_ERRORS.has(err.code);
      reject(
        new OmadaTransportError(
          certificate
            ? `certificate refused (${err.code})`
            : `cannot reach the controller (${err.code ?? err.message})`,
          { code: err.code, certificate },
        ),
      );
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * The cookie pairs (`name=value`) of a Set-Cookie header, attributes dropped.
 * @param {string | string[] | undefined} setCookie
 * @returns {Map<string, string>}
 */
export function parseSetCookie(setCookie) {
  const cookies = new Map();
  for (const line of [setCookie ?? []].flat()) {
    const pair = String(line).split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) {
      cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  return cookies;
}
