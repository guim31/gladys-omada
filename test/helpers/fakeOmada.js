// -----------------------------------------------------------------------------
// A fake Omada controller on 127.0.0.1: the Open API (client credentials) and
// the web API (local account) the integration uses, served from published
// answers of real controllers:
//   - test/fixtures/openapi: omini-plugin-omada test fixtures (MIT);
//   - test/fixtures/webapi: Home Assistant core tests/components/tplink_omada
//     fixtures (Apache-2.0).
// Both anonymized (192.0.2.x, 198.51.100.x, invented serials and ids).
//
// The state is mutable (a device goes offline, a WAN loses Internet, a client
// joins) and every request is recorded, so the tests drive scenarios end to
// end without network nor hardware.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = (path) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));

export const OMADAC_ID = '0123456789abcdef0123456789abcdef';
export const SITE_ID = '640effd1b3f2ae5b912275ec';
export const WEB_SITE_KEY = '000000000000000000000000';
export const CLIENT_ID = 'test-client-id';
export const CLIENT_SECRET = 'test-client-secret-0123';
export const USERNAME = 'gladys';
export const PASSWORD = 'test-password-0123';

const page = (rows) => ({ totalRows: rows.length, currentPage: 1, currentSize: 1000, data: rows });

/** Built here, after the shapes of the bullitt186/ha-omada-open-api tests (MIT). */
const POE_USAGE = [
  {
    mac: '50-C7-BF-00-00-02',
    name: 'Core switch',
    portNum: 28,
    totalPowerUsed: 45.3,
    totalPower: 240,
  },
];
const AP_OVERRIDES = {
  '50-C7-BF-00-00-03': [
    { ssidId: 's1', ssidEntryId: 1, ssidName: 'Home', ssidEnable: true, overrideSsidEnable: false },
    {
      ssidId: 's2',
      ssidEntryId: 2,
      ssidName: 'Guest',
      ssidEnable: true,
      overrideSsidEnable: false,
    },
  ],
  '50-C7-BF-00-00-04': [
    { ssidId: 's1', ssidEntryId: 1, ssidName: 'Home', ssidEnable: true, overrideSsidEnable: false },
    {
      ssidId: 's2',
      ssidEntryId: 2,
      ssidName: 'Guest',
      ssidEnable: true,
      overrideSsidEnable: false,
    },
  ],
};
/** The web fixtures name access points the device list lacks: one added here. */
const WEB_EXTRA_AP = {
  type: 'ap',
  mac: 'E8-48-B8-7E-C7-1A',
  name: 'Office',
  model: 'EAP245',
  showModel: 'EAP245 v3.0',
  firmwareVersion: '5.1.0',
  uptime: '2day(s) 1h 0m 0s',
  uptimeLong: 176400,
  cpuUtil: 4,
  memUtil: 50,
  status: 14,
  statusCategory: 1,
};

export function createOmadaState() {
  return {
    controllerVersion: '5.15.20.20',
    sites: fixture('openapi/sites.json').result.data,
    devices: fixture('openapi/devices.json').result.data,
    clients: fixture('openapi/clients.json').result.data,
    wanStatus: fixture('openapi/wan-status.json').result,
    poeUsage: structuredClone(POE_USAGE),
    apOverrides: structuredClone(AP_OVERRIDES),
    web: {
      devices: [...fixture('webapi/devices.json'), structuredClone(WEB_EXTRA_AP)],
      clients: fixture('webapi/connected-clients.json'),
      gateway: fixture('webapi/gateway-TL-ER7212PC.json'),
      switchPorts: fixture('webapi/switch-ports-TL-SG3210XHP-M2.json'),
    },
    // v2 clients answer -1600, as on Fusion firmwares.
    clientsV2Unsupported: false,
    // Every Open API call answers this error code (e.g. -1005, -44112).
    forceErrorCode: null,
    failAll: false,
  };
}

/**
 * @param {{ state?: ReturnType<typeof createOmadaState> }} [options]
 */
export async function startFakeOmada({ state = createOmadaState() } = {}) {
  const requests = [];
  const tokens = new Set();
  const sessions = new Map(); // csrf token -> cookie value
  let tokenCount = 0;

  const ok = (result) => ({ errorCode: 0, msg: 'Success.', result });

  function openapi(method, path, url, body, req) {
    if (path === '/openapi/authorize/token') {
      if (method !== 'POST' || url.searchParams.get('grant_type') !== 'client_credentials') {
        return [400, { errorCode: -1001, msg: 'bad request' }];
      }
      if (
        body?.omadacId !== OMADAC_ID ||
        body?.client_id !== CLIENT_ID ||
        body?.client_secret !== CLIENT_SECRET
      ) {
        return [200, { errorCode: -44106, msg: 'Invalid client id or secret.' }];
      }
      tokenCount += 1;
      const accessToken = `AT-${tokenCount}`;
      tokens.add(accessToken);
      return [200, ok({ accessToken, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT' })];
    }
    const auth = String(req.headers.authorization ?? '').replace(/^AccessToken=/, '');
    if (!tokens.has(auth)) {
      return [200, { errorCode: -44113, msg: 'The access token is invalid.' }];
    }
    if (state.forceErrorCode !== null) {
      return [200, { errorCode: state.forceErrorCode, msg: 'forced' }];
    }
    const match = path.match(/^\/openapi\/(v1|v2)\/([^/]+)\/(.*)$/);
    if (!match || match[2] !== OMADAC_ID) {
      return [404, { errorCode: -1600, msg: 'Unsupported request path.' }];
    }
    const [, api, , rest] = match;
    const route = `${method} ${api} ${rest}`;
    const site = `sites/${SITE_ID}`;
    let m;
    if (route === 'GET v1 sites') return [200, ok(page(state.sites))];
    if (route === `GET v1 ${site}/devices`) return [200, ok(page(state.devices))];
    if (route === `POST v2 ${site}/clients`) {
      if (state.clientsV2Unsupported) return [200, { errorCode: -1600, msg: 'Unsupported' }];
      const rows =
        body?.scope === 1 ? state.clients.filter((c) => c.active !== false) : state.clients;
      return [200, ok(page(rows))];
    }
    if (route === `GET v1 ${site}/clients`) return [200, ok(page(state.clients))];
    if (new RegExp(`^GET v1 ${site}/gateways/([^/]+)/wan-status$`).test(route)) {
      if (!state.wanStatus) return [200, { errorCode: -1600, msg: 'Unsupported request path.' }];
      return [200, ok(state.wanStatus)];
    }
    if (route === `GET v1 ${site}/dashboard/poe-usage`) {
      if (!state.poeUsage) return [200, { errorCode: -1005, msg: 'No permission.' }];
      return [200, ok(state.poeUsage)];
    }
    if (
      new RegExp(`^PUT v1 ${site}/switches/([^/]+)/multi-ports/(profile-override|poe-mode)$`).test(
        route,
      )
    ) {
      return [200, ok(null)];
    }
    if (new RegExp(`^POST v1 ${site}/devices/([^/]+)/reboot$`).test(route)) {
      return [200, ok(null)];
    }
    if ((m = route.match(new RegExp(`^GET v2 ${site}/aps/([^/]+)/override$`)))) {
      return [200, ok({ ssidOverrides: state.apOverrides[m[1]] ?? [] })];
    }
    if ((m = route.match(new RegExp(`^PATCH v2 ${site}/aps/([^/]+)/override$`)))) {
      const list = state.apOverrides[m[1]] ?? [];
      for (const patch of body?.ssidOverrides ?? []) {
        const entry = list.find((e) => e.ssidEntryId === patch.ssidEntryId);
        if (entry && typeof patch.ssidEnable === 'boolean') entry.ssidEnable = patch.ssidEnable;
      }
      return [200, ok(null)];
    }
    return [404, { errorCode: -1600, msg: 'Unsupported request path.' }];
  }

  function web(method, path, url, body, req) {
    const prefix = `/${OMADAC_ID}/api/v2/`;
    if (!path.startsWith(prefix)) {
      return [404, { errorCode: -1600, msg: 'not found' }];
    }
    const rest = path.slice(prefix.length);
    if (rest === 'login' && method === 'POST') {
      if (body?.username !== USERNAME || body?.password !== PASSWORD) {
        return [200, { errorCode: -30109, msg: 'Invalid username or password.' }];
      }
      const token = `csrf-${sessions.size + 1}`;
      const cookie = `session-${sessions.size + 1}`;
      sessions.set(token, cookie);
      return [
        200,
        ok({ roleType: 0, token }),
        { 'Set-Cookie': `TPOMADA_SESSIONID=${cookie}; Path=/; HttpOnly` },
      ];
    }
    const csrf = String(req.headers['csrf-token'] ?? '');
    const cookie = String(req.headers.cookie ?? '').match(/TPOMADA_SESSIONID=([^;]+)/)?.[1];
    if (!sessions.has(csrf) || sessions.get(csrf) !== cookie) {
      // An expired session answers the login page.
      return [200, '<html>login</html>'];
    }
    const site = `sites/${WEB_SITE_KEY}`;
    if (rest === 'users/current') {
      return [200, ok({ privilege: { sites: [{ name: 'Test', key: WEB_SITE_KEY }] } })];
    }
    if (rest === `${site}/devices`) return [200, ok(state.web.devices)];
    if (rest === `${site}/clients`) {
      return [
        200,
        ok({
          totalRows: state.web.clients.length,
          currentPage: 1,
          currentSize: 100,
          data: state.web.clients,
        }),
      ];
    }
    if (rest === `${site}/gateways/${state.web.gateway.mac}`) return [200, ok(state.web.gateway)];
    if (rest.startsWith(`${site}/switches/`) && rest.endsWith('/ports')) {
      return [200, ok(state.web.switchPorts)];
    }
    return [404, { errorCode: -1600, msg: 'not found' }];
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;
      requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        headers: req.headers,
      });
      let answer;
      if (state.failAll) {
        answer = [503, { errorCode: -1, msg: 'down' }];
      } else if (url.pathname === '/api/info') {
        answer = [
          200,
          ok({ controllerVer: state.controllerVersion, apiVer: '3', omadacId: OMADAC_ID, type: 1 }),
        ];
      } else if (url.pathname.startsWith('/openapi/') && req.headers.authorization !== undefined) {
        answer = openapi(req.method, url.pathname, url, body, req);
      } else if (url.pathname === '/openapi/authorize/token') {
        answer = openapi(req.method, url.pathname, url, body, req);
      } else if (url.pathname.startsWith('/openapi/')) {
        // The web session reaching an Open API path (controller 6.2+).
        answer = [404, { errorCode: -1600, msg: 'not found' }];
      } else {
        answer = web(req.method, url.pathname, url, body, req);
      }
      const [status, payload, headers = {}] = answer;
      const isText = typeof payload === 'string';
      res.writeHead(status, {
        'Content-Type': isText ? 'text/html' : 'application/json;charset=UTF-8',
        ...headers,
      });
      res.end(isText ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    /** Requests of one kind, e.g. calls('PUT') or calls(undefined, /reboot/). */
    calls(method, pattern) {
      return requests.filter(
        (r) => (!method || r.method === method) && (!pattern || pattern.test(r.path)),
      );
    },
    /** Every access token issued so far becomes invalid. */
    expireTokens() {
      tokens.clear();
    },
    expireSessions() {
      sessions.clear();
    },
    setDeviceStatus(mac, online) {
      const device = state.devices.find((d) => d.mac === mac);
      device.status = online ? 1 : 0;
    },
    setWanInternet(port, online) {
      const wan = state.wanStatus.find((w) => w.port === port);
      wan.internetState = online ? 1 : 0;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
