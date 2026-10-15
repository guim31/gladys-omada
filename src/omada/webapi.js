// -----------------------------------------------------------------------------
// The web API of the controller, with a local administrator account: the API
// the Omada web interface itself uses, and the one of the Home Assistant core
// integration (library tplink-omada-client, MIT). Read-only here.
//
// Login: `POST /{omadacId}/api/v2/login` returns a CSRF token and sets a
// session cookie; both go with every request. An expired session answers the
// login page (HTML) instead of JSON: one new login, then the request again.
//
// Why read-only: switching PoE through this API means rewriting the whole port
// configuration (bandwidth limits and mirroring are reset), and the Open API
// gives the commands a dedicated application with its own role. The commands
// therefore need the Open API mode.
// -----------------------------------------------------------------------------

import { normalizeBaseUrl, parseSetCookie } from './http.js';
import { createPacedRequest, fetchControllerInfo, optional, pickSite, poeMap } from './base.js';
import { ERROR_KINDS, OmadaApiError, versionAtLeast, WEB_LOGIN_FAILED } from './errors.js';
import { macApi, normalizeClient, normalizeDevice, normalizeWanPorts } from './model.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/**
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.username
 * @param {string} options.password
 * @param {boolean} [options.insecure]
 * @param {Function} [options.send]
 * @param {() => number} [options.now]
 */
export function createWebApiClient({
  url,
  username,
  password,
  insecure = false,
  send = createPacedRequest(),
  now = () => Date.now(),
}) {
  const baseUrl = normalizeBaseUrl(url);
  let info = null;
  let csrfToken = null;
  let cookies = new Map();

  async function controllerInfo() {
    if (!info) {
      info = await fetchControllerInfo(send, baseUrl, insecure);
      if (info.version && !versionAtLeast(info.version, '5.0')) {
        throw new OmadaApiError(`controller ${info.version} is too old (5.0 or later needed)`, {
          kind: ERROR_KINDS.NOT_OMADA,
        });
      }
    }
    return info;
  }

  function sessionHeaders() {
    const headers = {
      Referer: `${baseUrl}/`,
      Origin: baseUrl,
      'Omada-Request-Source': 'web-local',
    };
    if (csrfToken) headers['Csrf-Token'] = csrfToken;
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    return headers;
  }

  async function login() {
    const { omadacId } = await controllerInfo();
    csrfToken = null;
    cookies = new Map();
    const res = await send({
      url: `${baseUrl}/${omadacId}/api/v2/login`,
      method: 'POST',
      body: { username, password },
      headers: sessionHeaders(),
      insecure,
    });
    const code = res.json?.errorCode;
    if (code !== 0 || !res.json?.result?.token) {
      throw new OmadaApiError(
        code === WEB_LOGIN_FAILED || res.status === 401
          ? 'the controller refused the username or the password'
          : `the controller refused the login (${code ?? `HTTP ${res.status}`})`,
        { kind: ERROR_KINDS.AUTH, errorCode: code ?? null, status: res.status },
      );
    }
    csrfToken = res.json.result.token;
    cookies = parseSetCookie(res.headers['set-cookie']);
  }

  /**
   * One authenticated call. `path` is relative to `/{omadacId}/api/v2/`, or
   * starts with `/openapi/` for the endpoints the web session also reaches.
   */
  async function call(method, path, { query, body } = {}) {
    const { omadacId } = await controllerInfo();
    if (!csrfToken) {
      await login();
    }
    const search = query ? `?${new URLSearchParams(Object.entries(query)).toString()}` : '';
    const target = path.startsWith('/openapi/')
      ? `${baseUrl}${path.replace('{omadacId}', omadacId)}${search}`
      : `${baseUrl}/${omadacId}/api/v2/${path}${search}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await send({ url: target, method, body, headers: sessionHeaders(), insecure });
      const code = res.json?.errorCode;
      // An expired session: the login page instead of JSON, 401, or -30109.
      const lost =
        res.status === 401 ||
        code === WEB_LOGIN_FAILED ||
        (res.status === 200 && !res.contentType.includes('json'));
      if (lost && attempt === 0) {
        await login();
        continue;
      }
      if (res.status === 403 || code === -1005 || code === -1007) {
        throw new OmadaApiError(`${path}: refused to this account (${code ?? 403})`, {
          kind: ERROR_KINDS.FORBIDDEN,
          errorCode: code ?? null,
        });
      }
      if (res.status === 404 || code === -1600) {
        throw new OmadaApiError(`${path}: not supported by this controller`, {
          kind: ERROR_KINDS.UNSUPPORTED,
          errorCode: code ?? null,
        });
      }
      if (lost) {
        throw new OmadaApiError('the controller keeps closing the session', {
          kind: ERROR_KINDS.AUTH,
        });
      }
      if (res.status >= 400 || typeof code !== 'number') {
        throw new OmadaApiError(`${path}: unexpected answer (HTTP ${res.status})`, {
          status: res.status,
        });
      }
      if (code !== 0) {
        throw new OmadaApiError(`${path}: error ${code} (${res.json?.msg ?? ''})`, {
          errorCode: code,
        });
      }
      return res.json.result;
    }
    throw new OmadaApiError('unreachable');
  }

  async function connectedClients(siteId) {
    const { version } = await controllerInfo();
    const rows = [];
    if (version && versionAtLeast(version, '6.2')) {
      // Controller 6.2+: the web list moved to the Open API path (same session).
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await call('POST', `/openapi/v2/{omadacId}/sites/${siteId}/clients`, {
          body: {
            filters: { active: true },
            sorts: {},
            hideHealthUnsupported: true,
            scope: 1,
            page,
            pageSize: PAGE_SIZE,
          },
        });
        const data = Array.isArray(result?.data) ? result.data : [];
        rows.push(...data);
        if (data.length === 0 || rows.length >= Number(result?.totalRows)) break;
      }
      return rows;
    }
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      // Same query as tplink-omada-client; the inactive rows are dropped by
      // normalizeClient (`active: false`).
      const result = await call('GET', `sites/${siteId}/clients`, {
        query: { 'filters.active': 'false', currentPage: page, currentPageSize: PAGE_SIZE },
      });
      const data = Array.isArray(result?.data) ? result.data : [];
      rows.push(...data);
      if (data.length === 0 || rows.length >= Number(result?.totalRows)) break;
    }
    return rows;
  }

  return {
    mode: 'local_account',
    canWrite: false,

    async connect(siteWanted) {
      const { version } = await controllerInfo();
      await login();
      const user = await call('GET', 'users/current');
      const sites = (user?.privilege?.sites ?? []).map((site) => ({
        id: String(site.key ?? site.id ?? ''),
        name: String(site.name ?? ''),
        primary: false,
      }));
      return { version, site: pickSite(sites, siteWanted) };
    },

    async snapshot(site) {
      const raw = await call('GET', `sites/${site.id}/devices`);
      const devices = (Array.isArray(raw) ? raw : []).map(normalizeDevice).filter(Boolean);
      const clients = (await connectedClients(site.id)).map(normalizeClient).filter(Boolean);
      const wans = [];
      for (const gateway of devices.filter((d) => d.type === 'gateway' && d.online)) {
        const detail = await optional(() =>
          call('GET', `sites/${site.id}/gateways/${macApi(gateway.mac)}`),
        );
        wans.push(...normalizeWanPorts(gateway.mac, detail?.portStats ?? []));
      }
      const poeEntries = [];
      for (const sw of devices.filter((d) => d.type === 'switch' && d.online)) {
        const ports = await optional(() =>
          call('GET', `sites/${site.id}/switches/${macApi(sw.mac)}/ports`),
        );
        const powers = (Array.isArray(ports) ? ports : [])
          .map((port) => port?.portStatus?.poePower)
          .filter((watts) => typeof watts === 'number');
        // A switch without PoE reports no poePower at all.
        poeEntries.push([sw.mac, powers.length > 0 ? powers.reduce((a, b) => a + b, 0) : null]);
      }
      return {
        siteId: site.id,
        siteName: site.name,
        devices,
        clients,
        wans,
        poe: poeMap(poeEntries),
        at: now(),
      };
    },
  };
}
