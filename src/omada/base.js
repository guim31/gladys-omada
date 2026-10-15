// -----------------------------------------------------------------------------
// What both APIs share: the unauthenticated controller info, the request
// pacing, and the choice of the site.
// -----------------------------------------------------------------------------

import { requestJson } from './http.js';
import { ERROR_KINDS, OmadaApiError } from './errors.js';

/**
 * Space the requests: Omada controllers accept about 10 requests per second
 * (Open API access guide, "API call budget"), and an OC200 is a small box.
 * One request at a time, at least `minIntervalMs` apart.
 * @param {object} options
 * @param {typeof requestJson} [options.request]
 * @param {number} [options.minIntervalMs]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createPacedRequest({
  request = requestJson,
  minIntervalMs = 150,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let queue = Promise.resolve();
  let last = -Infinity;
  return (options) => {
    const run = queue.then(async () => {
      const wait = minIntervalMs - (now() - last);
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await request(options);
      } finally {
        last = now();
      }
    });
    // The next request waits for this one, whatever its outcome.
    queue = run.catch(() => {});
    return run;
  };
}

/**
 * `GET /api/info`: version and Omada ID (omadacId) of the controller, without
 * login. The Omada web interface reads it first, and so do both APIs.
 * @param {(options: object) => Promise<{status: number, json: any}>} send
 * @param {string} baseUrl
 * @param {boolean} insecure
 * @returns {Promise<{ omadacId: string, version: string|null }>}
 */
export async function fetchControllerInfo(send, baseUrl, insecure) {
  const res = await send({ url: `${baseUrl}/api/info`, insecure });
  const result = res.json?.result;
  if (res.status >= 400 || !result || typeof result.omadacId !== 'string' || !result.omadacId) {
    throw new OmadaApiError(
      'the address does not answer like an Omada controller (no Omada ID in /api/info)',
      { kind: ERROR_KINDS.NOT_OMADA, status: res.status },
    );
  }
  return { omadacId: result.omadacId, version: result.controllerVer ?? null };
}

/**
 * Pick the configured site among those the credentials can see: by id, then
 * by name (case-insensitive); with no site configured, the primary one, or the
 * only one.
 * @param {Array<{ id: string, name: string, primary?: boolean }>} sites
 * @param {string} wanted
 * @returns {{ id: string, name: string }}
 */
export function pickSite(sites, wanted) {
  const target = String(wanted ?? '').trim();
  if (target !== '') {
    const lower = target.toLowerCase();
    const found =
      sites.find((site) => site.id === target) ??
      sites.find((site) => String(site.name).toLowerCase() === lower);
    if (found) {
      return { id: found.id, name: found.name };
    }
  } else {
    const found = sites.find((site) => site.primary) ?? (sites.length === 1 ? sites[0] : null);
    if (found) {
      return { id: found.id, name: found.name };
    }
  }
  const names = sites.map((site) => site.name).join(', ') || '-';
  const err = new OmadaApiError(`site "${target}" not found (sites: ${names})`, {
    kind: ERROR_KINDS.SITE,
  });
  err.detail = names;
  throw err;
}

/**
 * Turn a list of rows into a map MAC → PoE power (W), for the switches that
 * report one.
 * @param {Iterable<[string|null, number|null]>} entries
 */
export function poeMap(entries) {
  const map = new Map();
  for (const [mac, watts] of entries) {
    if (mac && typeof watts === 'number' && Number.isFinite(watts)) {
      map.set(mac, Math.round(watts * 10) / 10);
    }
  }
  return map;
}
