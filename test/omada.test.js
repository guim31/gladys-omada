// -----------------------------------------------------------------------------
// The controller clients against the fake controller, and the data model on
// the published answers of real controllers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOpenApiClient } from '../src/omada/openapi.js';
import { createWebApiClient } from '../src/omada/webapi.js';
import { createPacedRequest, pickSite } from '../src/omada/base.js';
import { normalizeBaseUrl, requestJson } from '../src/omada/http.js';
import { ERROR_KINDS, versionAtLeast } from '../src/omada/errors.js';
import {
  macApi,
  macKey,
  normalizeClient,
  normalizeDevice,
  normalizeWanPorts,
  parseUptime,
} from '../src/omada/model.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  OMADAC_ID,
  PASSWORD,
  SITE_ID,
  USERNAME,
  startFakeOmada,
} from './helpers/fakeOmada.js';

const fixture = (path) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
const send = createPacedRequest({ minIntervalMs: 0 });

const openapi = (omada, overrides = {}) =>
  createOpenApiClient({
    url: omada.url,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    send,
    ...overrides,
  });

test('the device status trap: 0/1 in the Open API, statusCategory in the web API', () => {
  const [ap, gateway] = fixture('openapi/devices.json').result.data;
  assert.equal(normalizeDevice(ap).online, true); // status 1, detailStatus 14
  assert.equal(normalizeDevice(gateway).online, true);
  const garage = fixture('openapi/devices.json').result.data.find((d) => d.name === 'AP Garage');
  assert.equal(normalizeDevice(garage).online, false); // status 0
  const pending = fixture('openapi/devices.json').result.data.find((d) => d.status === 2);
  assert.equal(normalizeDevice(pending).online, false);

  const [router, poeSwitch] = fixture('webapi/devices.json');
  assert.equal(router.status, 14); // a detail code, not "online"
  assert.equal(normalizeDevice(router).online, true); // statusCategory 1
  assert.equal(normalizeDevice({ ...poeSwitch, statusCategory: 0 }).online, false);
});

test('an offline device reports no reading, and a device named after its MAC gets its model', () => {
  const garage = normalizeDevice(
    fixture('openapi/devices.json').result.data.find((d) => d.name === 'AP Garage'),
  );
  assert.deepEqual([garage.cpu, garage.memory, garage.uptime], [null, null, null]);
  const unnamed = normalizeDevice(
    fixture('openapi/devices.json').result.data.find((d) => d.mac === '50-C7-BF-00-00-06'),
  );
  assert.equal(unnamed.name, 'EAP245 00-06');
});

test('uptime: uptimeLong of the web API, display string of the Open API', () => {
  assert.equal(parseUptime({ uptimeLong: 2785167, uptime: '32day(s) 5h 39m 27s' }), 2785167);
  assert.equal(parseUptime({ uptime: '3day(s) 4h 12m 9s' }), 3 * 86400 + 4 * 3600 + 12 * 60 + 9);
  assert.equal(parseUptime({ uptime: '' }), null);
  assert.equal(parseUptime({}), null);
});

test('MAC addresses: one key form, one API form', () => {
  assert.equal(macKey('AA-BB-CC-DD-EE-FF'), 'aabbccddeeff');
  assert.equal(macKey('aa:bb:cc:dd:ee:ff'), 'aabbccddeeff');
  assert.equal(macKey('not a mac'), null);
  assert.equal(macApi('aabbccddeeff'), 'AA-BB-CC-DD-EE-FF');
});

test('clients: inactive rows dropped, uplink by connection type, host name over a MAC name', () => {
  const rows = fixture('openapi/clients.json').result.data;
  const clients = rows.map(normalizeClient).filter(Boolean);
  assert.equal(clients.length, 4); // "old laptop" is active: false
  const phone = clients.find((c) => c.name === 'Phone');
  assert.deepEqual(
    [phone.wireless, phone.ssid, phone.uplink, phone.download, phone.upload],
    [true, 'Home', '50c7bf000003', 125000, 2500],
  );
  // Named after its MAC by the controller: its host name says more.
  assert.equal(clients.find((c) => c.mac === 'aabbccddee02').name, 'esp-plug');
  assert.equal(clients.find((c) => c.name === 'nas').uplink, '50c7bf000002');
  assert.equal(clients.find((c) => c.name === 'printer').uplink, '50c7bf000001');

  // Web API (Home Assistant fixture): no uploadActivity on this controller.
  const web = fixture('webapi/connected-clients.json').map(normalizeClient);
  assert.equal(web[0].upload, null);
  assert.equal(web[0].uplink, 'e848b87ec71a');
});

test('WAN ports: only the ports in WAN mode, Internet only with the link up', () => {
  const wans = normalizeWanPorts('50-C7-BF-00-00-01', fixture('openapi/wan-status.json').result);
  assert.deepEqual(
    wans.map((w) => [w.port, w.name, w.label, w.linkUp, w.online, w.download]),
    [
      [1, 'WAN1', 'Fiber ISP', true, true, 120],
      [3, 'WAN/LAN3', 'WAN/LAN3', false, false, 0],
    ],
  );
  // The real ER7212PC answer: WAN/LAN4 is the only port in WAN mode (mode 0).
  const gw = fixture('webapi/gateway-TL-ER7212PC.json');
  const web = normalizeWanPorts(gw.mac, gw.portStats);
  assert.deepEqual(
    web.map((w) => [w.port, w.name, w.online, w.download, w.upload]),
    [[4, 'WAN/LAN4', true, 18, 3]],
  );
});

test('the site: by id, by name whatever the case, the primary one when none is set', () => {
  const sites = [
    { id: 'a', name: 'Default', primary: true },
    { id: 'b', name: 'Office' },
  ];
  assert.equal(pickSite(sites, 'office').id, 'b');
  assert.equal(pickSite(sites, 'b').name, 'Office');
  assert.equal(pickSite(sites, '').id, 'a');
  assert.throws(
    () => pickSite(sites, 'Garage'),
    (err) => {
      assert.equal(err.kind, ERROR_KINDS.SITE);
      assert.equal(err.detail, 'Default, Office');
      return true;
    },
  );
});

test('versions and addresses', () => {
  assert.ok(versionAtLeast('5.15.20.20', '5.9'));
  assert.ok(!versionAtLeast('5.8.4', '5.9'));
  assert.ok(versionAtLeast('6.2.0.0', '6.2'));
  assert.equal(normalizeBaseUrl(' 192.0.2.10:8043/ '), 'https://192.0.2.10:8043');
  assert.equal(normalizeBaseUrl('http://192.0.2.10'), 'http://192.0.2.10');
});

test('Open API: token, site, one read of the site', async () => {
  const omada = await startFakeOmada();
  try {
    const client = openapi(omada);
    const { version, site } = await client.connect('Default');
    assert.equal(version, '5.15.20.20');
    assert.deepEqual(site, { id: SITE_ID, name: 'Default' });
    const [token] = omada.calls('POST', /authorize\/token/);
    assert.deepEqual(token.query, { grant_type: 'client_credentials' });
    assert.deepEqual(token.body, {
      omadacId: OMADAC_ID,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const snapshot = await client.snapshot(site);
    assert.equal(snapshot.devices.length, 6);
    assert.equal(snapshot.clients.length, 4);
    assert.equal(snapshot.wans.length, 2);
    assert.equal(snapshot.poe.get('50c7bf000002'), 45.3);
    // Each read: devices, clients (v2), WAN of the online gateway, PoE.
    assert.ok(omada.calls('GET', /wan-status$/).length === 1);
    assert.equal(omada.calls('POST', /\/openapi\/v2\/.*\/clients$/)[0].body.scope, 1);
    assert.equal(omada.calls('POST', /authorize\/token/).length, 1, 'one token for every call');
  } finally {
    await omada.close();
  }
});

test('Open API: an expired token is renewed once, with the client credentials', async () => {
  const omada = await startFakeOmada();
  try {
    const client = openapi(omada);
    const { site } = await client.connect('');
    omada.expireTokens();
    const snapshot = await client.snapshot(site);
    assert.equal(snapshot.devices.length, 6);
    assert.equal(omada.calls('POST', /authorize\/token/).length, 2);
  } finally {
    await omada.close();
  }
});

test('Open API: wrong secret, forbidden role, unknown site', async () => {
  const omada = await startFakeOmada();
  try {
    await assert.rejects(openapi(omada, { clientSecret: 'wrong' }).connect('Default'), {
      kind: ERROR_KINDS.AUTH,
      errorCode: -44106,
    });
    await assert.rejects(openapi(omada).connect('Garage'), { kind: ERROR_KINDS.SITE });
    const client = openapi(omada);
    const { site } = await client.connect('Default');
    omada.state.forceErrorCode = -1005;
    await assert.rejects(client.snapshot(site), { kind: ERROR_KINDS.FORBIDDEN });
  } finally {
    await omada.close();
  }
});

test('a refused optional part (WAN status, PoE) does not fail the whole read', async () => {
  const omada = await startFakeOmada();
  try {
    const client = openapi(omada);
    const { site } = await client.connect('Default');
    omada.state.wanStatus = undefined; // the fake then answers -1600 for wan-status
    const original = omada.state.poeUsage;
    omada.state.poeUsage = undefined;
    const snapshot = await client.snapshot(site);
    assert.equal(snapshot.devices.length, 6);
    assert.equal(snapshot.wans.length, 0);
    assert.equal(snapshot.poe.size, 0);
    omada.state.poeUsage = original;
  } finally {
    await omada.close();
  }
});

test('Open API: a firmware without the v2 clients list falls back to v1, for good', async () => {
  const omada = await startFakeOmada();
  try {
    omada.state.clientsV2Unsupported = true;
    const client = openapi(omada);
    const { site } = await client.connect('Default');
    assert.equal((await client.snapshot(site)).clients.length, 4);
    await client.snapshot(site);
    assert.equal(omada.calls('POST', /\/clients$/).length, 1, 'v2 tried once');
    assert.equal(omada.calls('GET', /\/v1\/.*\/clients$/).length, 2);
  } finally {
    await omada.close();
  }
});

test('Open API commands: PoE with a profile override, restart, SSID on every AP', async () => {
  const omada = await startFakeOmada();
  try {
    const client = openapi(omada);
    const { site } = await client.connect('Default');
    await client.setPoe(site, '50c7bf000002', 5, false);
    const puts = omada.calls('PUT');
    assert.deepEqual(
      puts.map((r) => [r.path.split('/').slice(-2).join('/'), r.body]),
      [
        ['multi-ports/profile-override', { portList: [5], profileOverrideEnable: true }],
        ['multi-ports/poe-mode', { portList: [5], poeMode: 0 }],
      ],
    );
    assert.match(puts[0].path, /\/switches\/50-C7-BF-00-00-02\//);

    await client.reboot(site, '50c7bf000003');
    assert.equal(omada.calls('POST', /\/devices\/50-C7-BF-00-00-03\/reboot$/).length, 1);

    const aps = [{ mac: '50c7bf000003' }, { mac: '50c7bf000004' }];
    assert.equal(await client.setSsid(site, aps, 'Guest', false), 2);
    const [patch] = omada.calls('PATCH');
    // The whole override list is sent back, the other SSID untouched.
    assert.deepEqual(patch.body.ssidOverrides, [
      { ssidEntryId: 1, overrideSsidEnable: false, overrideVlanEnable: false, ssidEnable: true },
      { ssidEntryId: 2, overrideSsidEnable: false, overrideVlanEnable: false, ssidEnable: false },
    ]);
    const ssids = await client.ssids(site, aps);
    assert.deepEqual(ssids.get('Guest'), { enabledOn: 0, disabledOn: 2 });
    assert.equal(await client.setSsid(site, aps, 'Nope', true), 0);
  } finally {
    await omada.close();
  }
});

test('web API: login, CSRF token and session cookie, a lost session renewed', async () => {
  const omada = await startFakeOmada();
  try {
    const client = createWebApiClient({
      url: omada.url,
      username: USERNAME,
      password: PASSWORD,
      send,
    });
    assert.equal(client.canWrite, false);
    const { site } = await client.connect('Test');
    const snapshot = await client.snapshot(site);
    assert.equal(snapshot.devices.length, 3);
    assert.equal(snapshot.clients.length, 3);
    assert.equal(snapshot.wans.length, 1);
    // TL-SG3210XHP-M2 ports: 2.7 + 10 + 7.7 + 1.9 W.
    assert.equal(snapshot.poe.get('54af97000001'), 22.3);
    const read = omada.calls('GET', /\/devices$/)[0];
    assert.match(read.headers['csrf-token'], /^csrf-/);
    assert.match(read.headers.cookie, /TPOMADA_SESSIONID=/);

    omada.expireSessions();
    assert.equal((await client.snapshot(site)).devices.length, 3);
    assert.equal(omada.calls('POST', /\/login$/).length, 2);
  } finally {
    await omada.close();
  }
});

test('web API: a wrong password is an authentication error', async () => {
  const omada = await startFakeOmada();
  try {
    const client = createWebApiClient({ url: omada.url, username: USERNAME, password: 'x', send });
    await assert.rejects(client.connect('Test'), { kind: ERROR_KINDS.AUTH, errorCode: -30109 });
  } finally {
    await omada.close();
  }
});

test('transport: something that is not an Omada controller, nothing listening', async () => {
  const omada = await startFakeOmada();
  try {
    omada.state.failAll = true;
    await assert.rejects(openapi(omada).connect('Default'), { kind: ERROR_KINDS.NOT_OMADA });
  } finally {
    await omada.close();
  }
  await assert.rejects(
    requestJson({ url: 'http://127.0.0.1:1/api/info', timeoutMs: 2000 }),
    (err) => err.name === 'OmadaTransportError' && err.certificate === false,
  );
});

test('the requests are paced: one at a time, a minimum interval apart', async () => {
  const starts = [];
  let clock = 0;
  const paced = createPacedRequest({
    minIntervalMs: 150,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    request: async () => {
      starts.push(clock);
      return { status: 200 };
    },
  });
  await Promise.all([paced({}), paced({}), paced({})]);
  assert.deepEqual(starts, [0, 150, 300]);
});
