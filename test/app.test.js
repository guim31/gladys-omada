// -----------------------------------------------------------------------------
// End to end: the integration between the SDK's fake Gladys and the fake Omada
// controller. Refresh by the container's own timer (no onPoll), presence with
// its departure delay, scene events on transitions only, commands behind their
// options, the widget, and quiet logs that never show a secret.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld } from './helpers/world.js';
import { createOmadaState, CLIENT_SECRET, PASSWORD } from './helpers/fakeOmada.js';
import { HEARTBEAT_MS } from '../src/app.js';
import { LANGUAGES } from '../src/config.js';

const SEL = 'ext:test-integration';
const equipment = (mac, feature) => `${SEL}:equipment:${mac}:${feature}`;
const presenceOf = (mac) => `${SEL}:client:${mac}:presence`;
const PHONE = 'aabbccddee01';
const SWITCH = `${SEL}:equipment:50c7bf000002`;
const AP = `${SEL}:equipment:50c7bf000003`;

/** A clock the tests move by hand. */
function createClock(start = Date.UTC(2026, 9, 15, 8, 0, 0)) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
  };
}

/** Wait until `condition()` holds, letting the real I/O of the fake controller run. */
async function until(condition, what) {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('the container refreshes the states by its own timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const world = await createWorld({ timers: true, now: clock.now });
  try {
    await world.addDevices();
    assert.equal(world.gladys.fake.lastState(equipment('50c7bf000003', 'online')), 1);

    world.omada.setDeviceStatus('50-C7-BF-00-00-03', false);
    world.omada.setWanInternet(1, false);
    clock.advance(60000);
    t.mock.timers.tick(60000);
    await until(
      () => world.gladys.fake.lastState(equipment('50c7bf000003', 'online')) === 0,
      'the AP offline state',
    );
    await until(
      () => world.gladys.fake.lastState(equipment('50c7bf000001', 'wan1_online')) === 0,
      'the WAN state',
    );
    // Gladys never polled: the timer did the work.
    assert.ok(!world.gladys.fake.wsMessages.some((m) => m.type === 'device.poll'));
  } finally {
    await world.close();
  }
});

test('onPoll is a fallback: it reads only when the timer has not for 90 % of a period', async () => {
  const clock = createClock();
  const world = await createWorld({ now: clock.now });
  try {
    const [device] = await world.addDevices((d) => d.external_id === AP);
    const reads = () => world.omada.calls('GET', /\/devices$/).length;
    const before = reads();
    assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
    assert.equal(reads(), before, 'just read: skipped');
    clock.advance(55000);
    await world.gladys.fake.poll(device);
    assert.equal(reads(), before + 1, 'the timer stalled: the fallback reads');
  } finally {
    await world.close();
  }
});

test('presence waits for the departure delay, and survives a controller outage', async () => {
  const clock = createClock();
  const world = await createWorld({ now: clock.now, config: { away_delay: 5 } });
  try {
    await world.addDevices((d) => d.external_id.endsWith(`client:${PHONE}`));
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 1);

    const phone = world.omada.state.clients.find((c) => c.mac === 'AA-BB-CC-DD-EE-01');
    world.omada.state.clients = world.omada.state.clients.filter((c) => c !== phone);
    clock.advance(60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 1, 'still within the delay');

    // The controller goes down for a long time: nobody leaves because of it.
    world.omada.state.failAll = true;
    clock.advance(10 * 60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 1);

    world.omada.state.failAll = false;
    await world.app.readNow();
    assert.equal(
      world.gladys.fake.lastState(presenceOf(PHONE)),
      0,
      'gone for longer than the delay',
    );

    world.omada.state.clients.push(phone);
    clock.advance(60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 1, 'back home');

    // The away client stays in the Discovery list: Gladys keeps offering it.
    world.omada.state.clients = world.omada.state.clients.filter((c) => c !== phone);
    await world.app.readNow();
    assert.ok(
      world.gladys.fake.discoveredDevices.some((d) => d.external_id === `${SEL}:client:${PHONE}`),
    );
  } finally {
    await world.close();
  }
});

test('a client Gladys knew as present keeps its delay after a restart', async () => {
  const clock = createClock();
  const state = createOmadaState();
  state.clients = state.clients.filter((c) => c.mac !== 'AA-BB-CC-DD-EE-01');
  const device = {
    name: 'Phone',
    external_id: `${SEL}:client:${PHONE}`,
    features: [{ external_id: presenceOf(PHONE), last_value: 1 }],
  };
  const world = await createWorld({ now: clock.now, state, devices: [device] });
  try {
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 1);
    clock.advance(6 * 60000);
    await world.app.readNow();
    assert.equal(world.gladys.fake.lastState(presenceOf(PHONE)), 0);
  } finally {
    await world.close();
  }
});

test('scene events fire on transitions only, never at startup', async () => {
  const world = await createWorld();
  try {
    assert.deepEqual(world.gladys.fake.sceneEvents, [], 'the first read only learns');

    world.omada.setDeviceStatus('50-C7-BF-00-00-02', false);
    world.omada.setWanInternet(1, false);
    world.omada.state.clients.push({
      mac: 'DE-AD-BE-EF-00-01',
      name: 'DE-AD-BE-EF-00-01',
      hostName: 'unknown-laptop',
      ip: '192.0.2.150',
      wireless: true,
      ssid: 'Guest',
      guest: true,
      apMac: '50-C7-BF-00-00-03',
      apName: 'AP Living room',
      connectDevType: 'ap',
      active: true,
    });
    await world.app.readNow();
    const byKey = Object.fromEntries(world.gladys.fake.sceneEvents.map((e) => [e.key, e.data]));
    assert.deepEqual(byKey.device_offline, {
      device: SWITCH,
      device_name: 'Core switch',
      device_type: 'switch',
      model: 'TL-SG3428X',
      mac: '50-C7-BF-00-00-02',
    });
    assert.deepEqual(byKey.wan_changed, {
      state: 'down',
      gateway: `${SEL}:equipment:50c7bf000001`,
      gateway_name: 'ER605',
      port_name: 'Fiber ISP',
      ip: null,
    });
    assert.deepEqual(byKey.new_unknown_client, {
      client: `${SEL}:client:deadbeef0001`,
      mac: 'DE-AD-BE-EF-00-01',
      name: 'unknown-laptop',
      ip: '192.0.2.150',
      connection: 'wireless',
      ssid: 'Guest',
      guest: 'yes',
      connected_to: 'AP Living room',
    });

    // Nothing changed: nothing fires again.
    const count = world.gladys.fake.sceneEvents.length;
    await world.app.readNow();
    assert.equal(world.gladys.fake.sceneEvents.length, count);

    world.omada.setWanInternet(1, true);
    await world.app.readNow();
    assert.equal(world.gladys.fake.sceneEvents.at(-1).data.state, 'up');
    assert.equal(world.gladys.fake.sceneEvents.at(-1).data.ip, '198.51.100.10');
  } finally {
    await world.close();
  }
});

test('the known clients are kept in /data: a restart fires nothing, a new MAC still does', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'omada-known-'));
  try {
    const first = await createWorld({ dataDir });
    await first.close();
    const stored = JSON.parse(await readFile(path.join(dataDir, 'known-clients.json'), 'utf8'));
    // MAC addresses only: no name, no address.
    assert.deepEqual(Object.keys(stored.sites), ['640effd1b3f2ae5b912275ec']);
    assert.ok(stored.sites['640effd1b3f2ae5b912275ec'].every((mac) => /^[0-9a-f]{12}$/.test(mac)));

    const second = await createWorld({ dataDir });
    try {
      second.omada.state.clients.push({
        mac: 'DE-AD-BE-EF-00-02',
        name: 'tablet',
        wireless: false,
        connectDevType: 'switch',
        switchMac: '50-C7-BF-00-00-02',
        active: true,
      });
      await second.app.readNow();
      assert.deepEqual(
        second.gladys.fake.sceneEvents.map((e) => [e.key, e.data.name]),
        [['new_unknown_client', 'tablet']],
      );
    } finally {
      await second.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a device added to Gladys gets its states at once, and the widget a refresh', async () => {
  const world = await createWorld();
  try {
    const refreshes = world.gladys.fake.widgetRefreshes.length;
    await world.addDevices((d) => d.external_id === SWITCH);
    assert.equal(world.gladys.fake.lastState(`${SWITCH}:poe_power`), 45.3);
    assert.equal(world.gladys.fake.lastState(`${SWITCH}:clients`), 1);
    assert.equal(world.gladys.fake.lastState(`${SWITCH}:uptime`), 240);
    assert.ok(world.gladys.fake.widgetRefreshes.length > refreshes);
    // Only the features of the devices added: no state for the others.
    assert.ok(
      world.gladys.fake.states.every((s) => s.device_feature_external_id.startsWith(SWITCH)),
    );
  } finally {
    await world.close();
  }
});

test('only the changes are published, with a heartbeat under 12 hours', async (t) => {
  const world = await createWorld();
  try {
    const calls = [];
    const original = world.gladys.publishChangedStates.bind(world.gladys);
    t.mock.method(world.gladys, 'publishChangedStates', async (states, options) => {
      calls.push(options);
      return original(states, options);
    });
    await world.addDevices();
    const count = world.gladys.fake.states.length;
    await world.app.readNow();
    assert.equal(world.gladys.fake.states.length, count, 'nothing changed, nothing sent');
    assert.ok(calls.length > 0);
    for (const options of calls) {
      assert.ok(options.heartbeat > 0 && options.heartbeat <= 12 * 60 * 60 * 1000);
    }
    assert.equal(HEARTBEAT_MS, 6 * 60 * 60 * 1000);
  } finally {
    await world.close();
  }
});

test('the Discovery list follows the option: equipment only when the clients are not offered', async () => {
  const world = await createWorld({ config: { discover_clients: false } });
  try {
    const ids = world.gladys.fake.discoveredDevices.map((d) => d.external_id);
    assert.equal(ids.length, 6);
    assert.ok(ids.every((id) => id.includes(':equipment:')));
  } finally {
    await world.close();
  }
});

test('connection status: not configured, credentials refused, connected', async () => {
  const world = await createWorld({ config: { client_secret: '' } });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Renseignez l'adresse/);

    await world.gladys.fake.configUpdated({ ...world.config, client_secret: 'wrong-secret-value' });
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.en, /credentials refused/);
    assert.match(world.gladys.fake.connectionStatus.message.de, /Zugangsdaten abgelehnt/);

    await world.gladys.fake.configUpdated({ ...world.config, client_secret: CLIENT_SECRET });
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    // Re-sent only on a change.
    const sent = world.gladys.fake.connectionStatuses.length;
    await world.app.readNow();
    assert.equal(world.gladys.fake.connectionStatuses.length, sent);
  } finally {
    await world.close();
  }
});

test('a wrong site lists the sites the credentials can see', async () => {
  const world = await createWorld({ config: { site: 'Garage' } });
  try {
    assert.match(
      world.gladys.fake.connectionStatus.message.fr,
      /site introuvable. Sites : Default, Office/,
    );
  } finally {
    await world.close();
  }
});

test('quiet logs: a normal cycle writes nothing at info, a failure once, the recovery once', async () => {
  const world = await createWorld();
  try {
    await world.addDevices();
    const startup = world.logger.at('info').length;
    for (let i = 0; i < 3; i += 1) await world.app.readNow();
    assert.equal(world.logger.at('info').length, startup, 'a normal cycle is silent at info');

    world.omada.state.failAll = true;
    for (let i = 0; i < 3; i += 1) await world.app.readNow();
    const warnings = world.logger.lines.filter((l) => l.level === 'warn');
    assert.equal(warnings.length, 1, 'one line for the first failure');
    world.omada.state.failAll = false;
    await world.app.readNow();
    await world.app.readNow();
    const recoveries = world.logger.lines.filter((l) => /reachable again/.test(l.text));
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].level, 'info');
  } finally {
    await world.close();
  }
});

test('a device lost and back is one info line each, never one per read', async () => {
  const world = await createWorld();
  try {
    world.omada.setDeviceStatus('50-C7-BF-00-00-03', false);
    await world.app.readNow();
    await world.app.readNow();
    world.omada.setDeviceStatus('50-C7-BF-00-00-03', true);
    await world.app.readNow();
    await world.app.readNow();
    const lines = world.logger.lines.filter((l) => l.text.startsWith('AP Living room'));
    assert.deepEqual(
      lines.map((l) => [l.level, l.text]),
      [
        ['info', 'AP Living room (ap) is offline'],
        ['info', 'AP Living room (ap) is back online'],
      ],
    );
  } finally {
    await world.close();
  }
});

for (const mode of ['openapi', 'local_account']) {
  test(`no secret of the configuration reaches the logs or Gladys (${mode})`, async () => {
    const world = await createWorld({
      mode,
      config: { allow_poe_control: true, allow_reboot: true, allow_ssid_control: true },
    });
    try {
      await world.addDevices();
      await world.gladys.fake.action('test_connection', {});
      await world.gladys.fake.action('set_poe', { device: SWITCH, port: 3, state: 'off' });
      await world.gladys.fake.action('reboot_device', { device: AP });
      await world.gladys.fake.action('set_ssid', { ssid: 'Guest', state: 'off' });
      world.omada.state.failAll = true;
      await world.app.readNow();
      // Wrong credentials too.
      await world.gladys.fake.configUpdated({
        ...world.config,
        client_secret: 'another-secret-value',
        password: 'another-password-value',
      });
      const secrets = [CLIENT_SECRET, PASSWORD, 'another-secret-value', 'another-password-value'];
      const logs = world.logger.lines.map((l) => l.text).join('\n');
      const toGladys = JSON.stringify(world.gladys.fake.requests.map((r) => r.body));
      const acks = JSON.stringify(world.gladys.fake.wsMessages);
      for (const secret of secrets) {
        assert.ok(!logs.includes(secret), `a secret is in the logs`);
        assert.ok(!toGladys.includes(secret), `a secret was sent to Gladys`);
        assert.ok(!acks.includes(secret), `a secret is in an ack`);
      }
    } finally {
      await world.close();
    }
  });
}

test('commands are off by default, and an action is never a device switch', async () => {
  const world = await createWorld();
  try {
    for (const [key, fields] of [
      ['set_poe', { device: SWITCH, port: 3, state: 'off' }],
      ['reboot_device', { device: AP }],
      ['set_ssid', { ssid: 'Guest', state: 'off' }],
    ]) {
      const ack = await world.gladys.fake.action(key, fields);
      assert.equal(ack.success, false, key);
      assert.match(ack.error, /désactivé/, key);
      const scene = await world.gladys.fake.sceneAction(key, fields);
      assert.equal(scene.success, false, key);
    }
    assert.equal(world.omada.calls('PUT').length + world.omada.calls('PATCH').length, 0);
    assert.equal(world.omada.calls('POST', /reboot/).length, 0);
    for (const device of world.gladys.fake.discoveredDevices) {
      assert.ok(
        device.features.every((f) => f.read_only === true),
        `${device.name}: writable feature`,
      );
    }
  } finally {
    await world.close();
  }
});

test('the local account mode is read-only: commands say so', async () => {
  const world = await createWorld({
    mode: 'local_account',
    config: { allow_poe_control: true, allow_reboot: true, allow_ssid_control: true },
  });
  try {
    const ack = await world.gladys.fake.action('reboot_device', {
      device: `${SEL}:equipment:aabbccddeeff`,
    });
    assert.equal(ack.success, false);
    assert.match(ack.error, /mode Open API/);
  } finally {
    await world.close();
  }
});

test('enabled commands reach the controller, with one info line each', async () => {
  const world = await createWorld({
    config: {
      allow_poe_control: true,
      allow_reboot: true,
      allow_ssid_control: true,
      language: 'en',
    },
  });
  try {
    const poe = await world.gladys.fake.action('set_poe', {
      device: SWITCH,
      port: 3,
      state: 'off',
    });
    assert.equal(poe.success, true);
    assert.equal(poe.data.message.fr, 'PoE coupé, port 3 de Core switch.');
    assert.deepEqual(world.omada.calls('PUT').at(-1).body, { portList: [3], poeMode: 0 });

    const scene = await world.gladys.fake.sceneAction('set_poe', {
      device: SWITCH,
      port: 3,
      state: 'on',
    });
    assert.equal(scene.success, true);
    assert.deepEqual(world.omada.calls('PUT').at(-1).body, { portList: [3], poeMode: 1 });

    const reboot = await world.gladys.fake.action('reboot_device', { device: AP });
    assert.equal(reboot.success, true);
    assert.equal(world.omada.calls('POST', /\/devices\/50-C7-BF-00-00-03\/reboot$/).length, 1);

    const ssid = await world.gladys.fake.sceneAction('set_ssid', { ssid: 'Guest', state: 'off' });
    assert.equal(ssid.success, true);
    assert.equal(world.omada.state.apOverrides['50-C7-BF-00-00-03'][1].ssidEnable, false);

    const lines = world.logger.lines.filter((l) => l.text.startsWith('Command:'));
    assert.deepEqual(
      lines.map((l) => [l.level, l.text]),
      [
        ['info', 'Command: PoE off on port 3 of Core switch'],
        ['info', 'Command: PoE on on port 3 of Core switch'],
        ['info', 'Command: restart of AP Living room'],
        ['info', 'Command: SSID Guest disabled on 2 AP(s)'],
      ],
    );
  } finally {
    await world.close();
  }
});

test('commands refuse a wrong target with a clear message', async () => {
  const world = await createWorld({
    config: {
      allow_poe_control: true,
      allow_reboot: true,
      allow_ssid_control: true,
      language: 'en',
    },
  });
  try {
    const cases = [
      ['set_poe', { device: AP, port: 3, state: 'off' }, /is not a switch/],
      ['set_poe', { device: SWITCH, port: 0, state: 'off' }, /whole number from 1 to 128/],
      ['set_poe', { device: SWITCH, port: 3, state: 'maybe' }, /Choose "On" or "Off"/],
      [
        'set_poe',
        { device: `${SEL}:client:${PHONE}`, port: 3, state: 'off' },
        /not a network client/,
      ],
      ['reboot_device', { device: `${SEL}:equipment:50c7bf000005` }, /AP Garage is offline/],
      ['reboot_device', { device: `${SEL}:equipment:010203040506` }, /not on the Omada site/],
      [
        'set_ssid',
        { ssid: 'Nope', state: 'on' },
        /No access point broadcasts "Nope". SSIDs: Home, Guest/,
      ],
    ];
    for (const [key, fields, message] of cases) {
      const ack = await world.gladys.fake.action(key, fields);
      assert.equal(ack.success, false, `${key} ${JSON.stringify(fields)}`);
      assert.match(ack.error, message);
    }
    assert.equal(world.omada.calls('PUT').length, 0);
  } finally {
    await world.close();
  }
});

test('the controller refusing a command is reported, not hidden', async () => {
  const world = await createWorld({ config: { allow_reboot: true, language: 'en' } });
  try {
    world.omada.state.forceErrorCode = -1005;
    const ack = await world.gladys.fake.action('reboot_device', { device: AP });
    assert.equal(ack.success, false);
    assert.match(ack.error, /refused the command: access refused/);
  } finally {
    await world.close();
  }
});

test('the connection test reports the site and what it found', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.action('test_connection', {});
    assert.equal(ack.success, true);
    assert.equal(
      ack.data.message.en,
      'Connected to site Default (controller 5.15.20.20): 6 Omada devices, 4 clients online.',
    );
    world.omada.state.failAll = true;
    const failed = await world.gladys.fake.action('test_connection', {});
    assert.equal(failed.success, false);
    assert.match(failed.error, /Contrôleur Omada injoignable/);
  } finally {
    await world.close();
  }
});

test('the widget content fits the core vocabulary in every language and state', async () => {
  const world = await createWorld();
  try {
    const features = new Set(
      world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
    );
    for (const language of LANGUAGES) {
      const ack = await world.gladys.fake.widgetGet('network', { language });
      assert.equal(ack.success, true);
      const { content } = ack.data;
      assert.deepEqual(validateWidgetContent(content), [], language);
      // Every component bound to a feature points at a feature that exists.
      for (const component of content.components) {
        if (component.device_feature) assert.ok(features.has(component.device_feature));
      }
    }
    const { content } = (await world.gladys.fake.widgetGet('network', { language: 'fr' })).data;
    const status = content.components.find((c) => c.type === 'status');
    assert.deepEqual(
      status.items.map((i) => [i.label, i.value]),
      [
        ['Fiber ISP', 'En ligne · 198.51.100.10'],
        ['WAN/LAN3', 'Pas de lien'],
        ['Équipements Omada en ligne', '4/6'],
        ['AP Garage', 'Hors ligne'],
        ['EAP245 00-06', 'Hors ligne'],
      ],
    );
    const tiles = content.components.filter((c) => c.type === 'value');
    assert.deepEqual(
      tiles.map((c) => [c.label, c.value]),
      [
        ['Clients', 4],
        ['Wi-Fi', 2],
        ['Filaires', 2],
        ['Descendant', 1],
        ['Montant', 0.2],
      ],
    );

    world.omada.state.failAll = true;
    await world.gladys.fake.configUpdated(world.config);
    const down = (await world.gladys.fake.widgetGet('network', { language: 'es' })).data.content;
    assert.deepEqual(validateWidgetContent(down), []);
    assert.match(down.components[0].text, /Controlador Omada inaccesible/);
  } finally {
    await world.close();
  }
});

test('the widget asks to be configured first', async () => {
  const world = await createWorld({ config: { controller_url: '' } });
  try {
    const { content } = (await world.gladys.fake.widgetGet('network', { language: 'de' })).data;
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].text, 'Konfiguriere zuerst die Integration.');
  } finally {
    await world.close();
  }
});
