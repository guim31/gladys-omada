// -----------------------------------------------------------------------------
// The official Omada Open API (controller 5.9 or later), client credentials
// mode: an application created in the controller (Global View → Settings →
// Platform Integration → Open API) with a client ID and a client secret.
//
// Every answer is `{ errorCode, msg, result }`; an errorCode other than 0 is a
// failure even with HTTP 200. Paths and bodies follow the access guide and two
// MIT clients that run against real controllers (bullitt186/ha-omada-open-api,
// riccardoalv/omini-plugin-omada).
//
// The access token lives in memory only (two hours): a new one is asked with
// the client credentials when it expires, rather than stored in /data.
// -----------------------------------------------------------------------------

import { normalizeBaseUrl } from './http.js';
import { createPacedRequest, fetchControllerInfo, optional, pickSite, poeMap } from './base.js';
import { ERROR_KINDS, OmadaApiError, OPENAPI_CODES } from './errors.js';
import { macApi, macKey, normalizeClient, normalizeDevice, normalizeWanPorts } from './model.js';

const PAGE_SIZE = 1000; // the largest page the Open API accepts
const MAX_PAGES = 20;

/**
 * @param {object} options
 * @param {string} options.url controller address
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} [options.omadacId] for a cloud-based controller, whose
 *   /api/info is not reachable: the Omada ID shown on its Open API page
 * @param {boolean} [options.insecure] accept a self-signed certificate
 * @param {Function} [options.send] paced request function (tests)
 * @param {() => number} [options.now]
 */
export function createOpenApiClient({
  url,
  clientId,
  clientSecret,
  omadacId: configuredId = '',
  insecure = false,
  send = createPacedRequest(),
  now = () => Date.now(),
}) {
  const baseUrl = normalizeBaseUrl(url);
  let info = null;
  let token = null;
  let tokenExpiresAt = 0;
  // Fusion firmwares answer -1600 to the v2 clients list: v1 from then on.
  let clientsV1 = false;

  async function controllerInfo() {
    if (!info) {
      info = configuredId.trim()
        ? { omadacId: configuredId.trim(), version: null }
        : await fetchControllerInfo(send, baseUrl, insecure);
    }
    return info;
  }

  async function authorize() {
    const { omadacId } = await controllerInfo();
    const res = await send({
      url: `${baseUrl}/openapi/authorize/token?grant_type=client_credentials`,
      method: 'POST',
      body: { omadacId, client_id: clientId, client_secret: clientSecret },
      insecure,
    });
    const code = res.json?.errorCode;
    if (code === OPENAPI_CODES.INVALID_CLIENT || res.status === 401) {
      throw new OmadaApiError('the controller refused the client ID or the client secret', {
        kind: ERROR_KINDS.AUTH,
        errorCode: code ?? null,
        status: res.status,
      });
    }
    const result = res.json?.result;
    if (code !== 0 || !result?.accessToken) {
      throw new OmadaApiError(
        `the controller refused the Open API authorization (${code ?? `HTTP ${res.status}`})`,
        { kind: res.status === 404 ? ERROR_KINDS.NOT_OMADA : ERROR_KINDS.AUTH, errorCode: code },
      );
    }
    token = result.accessToken;
    // A minute of margin: a token that expires during a request costs a retry.
    tokenExpiresAt = now() + (Number(result.expiresIn) || 7200) * 1000 - 60000;
    return token;
  }

  async function validToken() {
    if (!token || now() >= tokenExpiresAt) {
      return authorize();
    }
    return token;
  }

  /**
   * One authenticated call: `/openapi/{api}/{omadacId}/{path}`, its `result`.
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, string|number>, body?: unknown, api?: string }} [options]
   */
  async function call(method, path, { query, body, api = 'v1' } = {}) {
    const { omadacId } = await controllerInfo();
    const search = query ? `?${new URLSearchParams(Object.entries(query)).toString()}` : '';
    const target = `${baseUrl}/openapi/${api}/${omadacId}/${path}${search}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await send({
        url: target,
        method,
        body,
        headers: { Authorization: `AccessToken=${await validToken()}` },
        insecure,
      });
      const code = res.json?.errorCode;
      const expired =
        res.status === 401 ||
        code === OPENAPI_CODES.TOKEN_EXPIRED ||
        code === OPENAPI_CODES.TOKEN_INVALID;
      if (expired && attempt === 0) {
        token = null;
        continue;
      }
      if (res.status === 403 || OPENAPI_CODES.FORBIDDEN.includes(code)) {
        throw new OmadaApiError(`${path}: refused to this application (${code ?? 403})`, {
          kind: ERROR_KINDS.FORBIDDEN,
          errorCode: code ?? null,
          status: res.status,
        });
      }
      if (res.status === 404 || code === OPENAPI_CODES.UNSUPPORTED) {
        throw new OmadaApiError(`${path}: not supported by this controller`, {
          kind: ERROR_KINDS.UNSUPPORTED,
          errorCode: code ?? null,
          status: res.status,
        });
      }
      if (expired) {
        throw new OmadaApiError('the controller keeps refusing new access tokens', {
          kind: ERROR_KINDS.AUTH,
          errorCode: code ?? null,
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

  /** Every row of a paged list (`result.data`, `totalRows`). */
  async function pages(path, { api = 'v1', method = 'GET', body = {}, query = {} } = {}) {
    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result =
        method === 'GET'
          ? await call('GET', path, { api, query: { ...query, page, pageSize: PAGE_SIZE } })
          : await call(method, path, { api, query, body: { ...body, page, pageSize: PAGE_SIZE } });
      const data = Array.isArray(result?.data) ? result.data : [];
      rows.push(...data);
      const total = Number(result?.totalRows);
      if (data.length === 0 || !Number.isFinite(total) || rows.length >= total) {
        break;
      }
    }
    return rows;
  }

  async function connectedClients(siteId) {
    if (!clientsV1) {
      try {
        // scope 1: the clients online now.
        return await pages(`sites/${siteId}/clients`, {
          api: 'v2',
          method: 'POST',
          body: { scope: 1, filters: {} },
        });
      } catch (err) {
        if (err.kind !== ERROR_KINDS.UNSUPPORTED) {
          throw err;
        }
        clientsV1 = true;
      }
    }
    return pages(`sites/${siteId}/clients`);
  }

  /** The SSID overrides of one access point (v2 `aps/{mac}/override`). */
  async function apOverrides(siteId, apMac) {
    const result = await call('GET', `sites/${siteId}/aps/${macApi(apMac)}/override`, {
      api: 'v2',
    });
    return Array.isArray(result?.ssidOverrides) ? result.ssidOverrides : [];
  }

  return {
    mode: 'openapi',
    canWrite: true,

    /** Check the credentials and resolve the configured site. */
    async connect(siteWanted) {
      const { version } = await controllerInfo();
      await validToken();
      const rows = await pages('sites');
      const sites = rows.map((row) => ({
        id: String(row.siteId ?? row.id ?? ''),
        name: String(row.name ?? ''),
        primary: row.primary === true,
      }));
      return { version, site: pickSite(sites, siteWanted) };
    },

    /**
     * One read of the site: devices, connected clients, WAN ports, PoE.
     * @param {{ id: string, name: string }} site
     * @returns {Promise<import('./model.js').Snapshot>}
     */
    async snapshot(site) {
      const devices = (await pages(`sites/${site.id}/devices`))
        .map(normalizeDevice)
        .filter(Boolean);
      const clients = (await connectedClients(site.id)).map(normalizeClient).filter(Boolean);
      const wans = [];
      for (const gateway of devices.filter((d) => d.type === 'gateway' && d.online)) {
        const ports = await optional(() =>
          call('GET', `sites/${site.id}/gateways/${macApi(gateway.mac)}/wan-status`),
        );
        wans.push(...normalizeWanPorts(gateway.mac, Array.isArray(ports) ? ports : []));
      }
      let poe = new Map();
      if (devices.some((d) => d.type === 'switch' && d.online)) {
        // A site without PoE switch, or a role without the dashboard: no PoE reading.
        const usage = await optional(() => call('GET', `sites/${site.id}/dashboard/poe-usage`));
        poe = poeMap(
          (Array.isArray(usage) ? usage : []).map((row) => [
            macKey(row.mac),
            typeof row.totalPowerUsed === 'number' ? row.totalPowerUsed : null,
          ]),
        );
      }
      return { siteId: site.id, siteName: site.name, devices, clients, wans, poe, at: now() };
    },

    /**
     * Turn the PoE of one switch port on or off. The port first gets a profile
     * override: the PoE mode of a port following its profile cannot change.
     * Batch endpoints, as the single-port ones fail on many firmwares.
     */
    async setPoe(site, switchMac, port, on) {
      const base = `sites/${site.id}/switches/${macApi(switchMac)}/multi-ports`;
      await call('PUT', `${base}/profile-override`, {
        body: { portList: [port], profileOverrideEnable: true },
      });
      await call('PUT', `${base}/poe-mode`, { body: { portList: [port], poeMode: on ? 1 : 0 } });
    },

    async reboot(site, mac) {
      await call('POST', `sites/${site.id}/devices/${macApi(mac)}/reboot`);
    },

    /**
     * The SSIDs broadcast by the site's access points, with their state on each.
     * @returns {Promise<Map<string, { enabledOn: number, disabledOn: number }>>}
     */
    async ssids(site, accessPoints) {
      const byName = new Map();
      for (const ap of accessPoints) {
        for (const entry of await apOverrides(site.id, ap.mac)) {
          const name = String(entry.ssidName ?? '');
          if (!name) continue;
          const state = byName.get(name) ?? { enabledOn: 0, disabledOn: 0 };
          if (entry.ssidEnable === false) state.disabledOn += 1;
          else state.enabledOn += 1;
          byName.set(name, state);
        }
      }
      return byName;
    },

    /**
     * Enable or disable one SSID on every access point that carries it, through
     * the per-AP SSID override (the site-wide SSID settings only hide it).
     * The override list is sent back whole, as the API requires.
     * @returns {Promise<number>} how many access points carry the SSID
     */
    async setSsid(site, accessPoints, ssidName, on) {
      let carried = 0;
      for (const ap of accessPoints) {
        const overrides = await apOverrides(site.id, ap.mac);
        if (!overrides.some((entry) => entry.ssidName === ssidName)) {
          continue;
        }
        carried += 1;
        const ssidOverrides = overrides.map((entry) => {
          const patched = {
            ssidEntryId: entry.ssidEntryId,
            overrideSsidEnable: entry.overrideSsidEnable ?? false,
            overrideVlanEnable: entry.overrideVlanEnable ?? false,
          };
          if (entry.ssidName === ssidName) {
            patched.ssidEnable = on;
          } else if (typeof entry.ssidEnable === 'boolean') {
            patched.ssidEnable = entry.ssidEnable;
          }
          return patched;
        });
        await call('PATCH', `sites/${site.id}/aps/${macApi(ap.mac)}/override`, {
          api: 'v2',
          body: { ssidOverrides },
        });
      }
      return carried;
    },
  };
}
