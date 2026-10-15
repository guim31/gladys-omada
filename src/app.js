// -----------------------------------------------------------------------------
// The integration: connects to the controller, reads the site at the
// configured pace, and turns each read into device states, scene events, the
// Discovery list and the widget content.
//
// Refresh: the container reads the controller by itself, on its own timer.
// Gladys 5.2 does not reliably poll external devices (GladysAssistant/Gladys
// #3198, not fixed in 5.2.1), so the core's onPoll is only a fallback: it
// reads the site when the timer has not done it for 90 % of a period. One
// read covers every device of the site (4 to 6 requests).
//
// Logs: info is the lifecycle only (start, connection, a controller or a
// device lost and back, one line per command); a failure that repeats is
// written once, and once when it ends. The rest is debug (LOG_LEVEL=debug).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig, pollIntervalMs } from './config.js';
import { createOmadaClient } from './omada/client.js';
import { ERROR_KINDS } from './omada/errors.js';
import {
  CLIENT,
  FEATURE,
  buildDiscoveredDevices,
  featureValues,
  parseDeviceId,
} from './devices.js';
import { createPresence } from './presence.js';
import { createKnownClients } from './known-clients.js';
import { newClientEvent, transitionEvents } from './events.js';
import { WIDGET, buildNetworkContent } from './widgets.js';
import { createCommands } from './commands.js';
import { createIssueLog } from './issues.js';
import { TEXT, localized, pick, reasonOf, withReason } from './i18n.js';

/** A value that does not change is published again at least this often. */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration, or the SDK's fake Gladys
 * @param {string} [options.dataDir] the writable volume
 * @param {boolean} [options.timers] run the refresh timer (tests turn it off)
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 * @param {(config: object) => object} [options.createClient]
 */
export function createApp({
  gladys,
  dataDir = '/data',
  timers = true,
  now = () => Date.now(),
  logger = createLogger({ name: 'omada' }),
  createClient = (config) => createOmadaClient(config),
}) {
  const issues = createIssueLog(logger);
  const presence = createPresence();
  const known = createKnownClients({ dataDir, issues });

  let config = normalizeConfig();
  /** @type {{ client: object, site: { id: string, name: string }, version: string|null } | null} */
  let connection = null;
  let client = null;
  let snapshot = null;
  let lastError = null;
  let lastReadAt = 0;
  let inFlight = null;
  let timer = null;
  let stopped = true;
  let statusKey = null;
  let discoveredFingerprint = null;
  let widgetFingerprint = null;
  let seeded = false;
  // Equipment that was offline at the previous read, to log a return once.
  const offline = new Set();

  // --- Gladys side ----------------------------------------------------------

  async function setStatus(key, connected, message) {
    if (statusKey === key) return;
    statusKey = key;
    await gladys.setConnectionStatus(connected, message).catch((err) => {
      statusKey = null;
      logger.debug(`setConnectionStatus failed (${err.message})`);
    });
  }

  /** Our devices the user added to Gladys, with their feature ids. */
  function createdDevices() {
    return (gladys.devices ?? [])
      .map((device) => ({ device, parsed: parseDeviceId(gladys, device.external_id) }))
      .filter(({ parsed }) => parsed);
  }

  /** Before the first read: the clients Gladys knows as present keep their delay. */
  function seedPresence() {
    if (seeded) return;
    seeded = true;
    for (const { device, parsed } of createdDevices()) {
      if (parsed.kind !== CLIENT) continue;
      const feature = (device.features ?? []).find((f) =>
        String(f.external_id).endsWith(`:${FEATURE.PRESENCE}`),
      );
      if (feature?.last_value === 1) {
        presence.seed(parsed.mac, now());
      }
    }
  }

  /**
   * Publish the states of the devices added to Gladys, changed values only
   * (plus the heartbeat). `onlyDevice` limits it to one device.
   */
  async function publishStates(onlyDevice = null) {
    if (!snapshot) return;
    const created = createdDevices().filter(
      ({ device }) => !onlyDevice || device.external_id === onlyDevice,
    );
    if (created.length === 0) return;
    const clientMacs = created
      .filter(({ parsed }) => parsed.kind === CLIENT)
      .map((c) => c.parsed.mac);
    const values = featureValues(
      gladys,
      snapshot,
      (mac) => presence.presenceOf(mac, config.away_delay, now()),
      clientMacs,
    );
    const states = [];
    for (const { device } of created) {
      for (const feature of device.features ?? []) {
        const value = values.get(feature.external_id);
        if (value !== undefined) {
          states.push({ device_feature_external_id: feature.external_id, state: value });
        }
      }
    }
    if (states.length === 0) return;
    try {
      const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`${count} state(s) published`);
      issues.ok('states', 'States are accepted by Gladys again');
    } catch (err) {
      issues.fail('states', `Publishing the states failed (${err.message})`);
    }
  }

  async function publishDiscovered({ force = false } = {}) {
    if (!snapshot) return;
    const devices = buildDiscoveredDevices(gladys, snapshot, config);
    const fingerprint = JSON.stringify(devices);
    if (!force && fingerprint === discoveredFingerprint) return;
    try {
      await gladys.publishDiscoveredDevices(devices);
      discoveredFingerprint = fingerprint;
      issues.ok('discovery', 'Discovered devices accepted by Gladys again');
    } catch (err) {
      issues.fail('discovery', `Publishing the discovered devices failed (${err.message})`);
    }
  }

  function refreshWidget({ force = false } = {}) {
    const fingerprint = JSON.stringify(
      buildNetworkContent({
        snapshot,
        language: 'en',
        configured: isConfigured(config),
        error: lastError,
      }),
    );
    if (!force && fingerprint === widgetFingerprint) return;
    widgetFingerprint = fingerprint;
    Promise.resolve(gladys.requestWidgetRefresh(WIDGET.NETWORK)).catch(() => {});
  }

  async function fireEvents(previous) {
    const events = transitionEvents(gladys, previous, snapshot);
    const { fresh, learnt } = await known.observe(
      snapshot.siteId,
      snapshot.clients.map((c) => c.mac),
    );
    if (learnt > 0) {
      logger.debug(`${learnt} client(s) learnt without event`);
    }
    const byMac = new Map(snapshot.clients.map((c) => [c.mac, c]));
    for (const mac of fresh) {
      events.push(newClientEvent(gladys, byMac.get(mac)));
    }
    for (const event of events) {
      try {
        await gladys.publishSceneEvent(event.key, event.data);
        logger.debug(`Scene event ${event.key}`);
        issues.ok('scene-events', 'Scene events accepted by Gladys again');
      } catch (err) {
        issues.fail('scene-events', `Scene event ${event.key} refused (${err.message})`);
      }
    }
  }

  function logEquipmentChanges(previous) {
    for (const device of snapshot.devices) {
      if (!device.online && !offline.has(device.mac)) {
        offline.add(device.mac);
        // At the first read, an offline device is a state, not news.
        if (previous) logger.info(`${device.name} (${device.type}) is offline`);
      } else if (device.online && offline.delete(device.mac)) {
        logger.info(`${device.name} (${device.type}) is back online`);
      }
    }
  }

  // --- Controller side ------------------------------------------------------

  async function ensureConnection() {
    if (connection) return connection;
    client = createClient(config);
    const { version, site } = await client.connect(config.site);
    connection = { client, site, version };
    logger.info(
      `Connected to the Omada controller${version ? ` ${version}` : ''}, site ${site.name} ` +
        `(${config.auth_mode === 'openapi' ? 'Open API' : 'local account, read-only'})`,
    );
    return connection;
  }

  /** One read of the site, and everything that follows from it. */
  async function read() {
    if (!isConfigured(config)) {
      await setStatus('not-configured', false, localized(TEXT.notConfigured));
      return;
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: read skipped');
      return;
    }
    seedPresence();
    lastReadAt = now();
    let fresh;
    try {
      const { client: api, site } = await ensureConnection();
      fresh = await api.snapshot(site);
    } catch (err) {
      // Credentials or site refused: connect again next time (a fixed config).
      if ([ERROR_KINDS.AUTH, ERROR_KINDS.SITE, ERROR_KINDS.NOT_OMADA].includes(err.kind)) {
        connection = null;
      }
      lastError = withReason(TEXT.unreachable, err);
      issues.fail('controller', `Omada controller unreachable: ${pick(reasonOf(err), 'en')}`);
      logger.debug(`Read failed: ${err.message}`);
      await setStatus(`error:${err.kind ?? err.name}`, false, lastError);
      refreshWidget();
      return;
    }
    issues.ok('controller', 'Omada controller reachable again');
    lastError = null;
    await setStatus('ok', true);

    const previous = snapshot;
    // The app's clock dates the read: presence compares it with the same clock.
    snapshot = { ...fresh, at: now() };
    presence.update(snapshot);
    logEquipmentChanges(previous);
    logger.debug(
      `Read: ${snapshot.devices.length} devices, ${snapshot.clients.length} clients, ` +
        `${snapshot.wans.length} WAN port(s)`,
    );
    await publishDiscovered();
    await publishStates();
    await fireEvents(previous);
    refreshWidget();
  }

  /** Read now, or join the read in progress. */
  function readNow() {
    if (!inFlight) {
      inFlight = read()
        .catch((err) => logger.error(`Read cycle failed (${err.message})`))
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      // The core's onPoll may just have read the site: no second read.
      if (now() - lastReadAt >= pollIntervalMs(config) / 2) {
        await readNow();
      }
      schedule();
    }, pollIntervalMs(config));
    timer.unref?.();
  }

  /** A new config, a (re)connection to Gladys: start over. */
  async function restart(newConfig) {
    config = normalizeConfig(newConfig);
    connection = null;
    snapshot = null;
    discoveredFingerprint = null;
    statusKey = null;
    stopped = false;
    schedule();
    await readNow();
  }

  const commands = createCommands({
    gladys,
    getConfig: () => config,
    session: async () => {
      const { client: api, site } = await ensureConnection();
      return { client: api, site, snapshot };
    },
    refresh: () => {
      // Let the controller apply the command before reading it again.
      if (timers) setTimeout(() => readNow(), 5000).unref?.();
    },
    logger,
  });

  // --- Handlers -------------------------------------------------------------

  function register() {
    gladys.onScanRequest(async () => {
      logger.debug('Scan requested');
      await readNow();
      await publishDiscovered({ force: true });
    });

    gladys.onPoll(async (device) => {
      // Fallback of the timer: one read covers the whole site.
      if (now() - lastReadAt >= pollIntervalMs(config) * 0.9) {
        await readNow();
      } else {
        logger.debug(
          `onPoll skipped (read ${now() - lastReadAt} ms ago) for ${device.external_id}`,
        );
      }
    });

    const onAdded = async (device) => {
      // The SDK forgot what it had published for this device: send it now.
      await publishStates(device.external_id);
      refreshWidget({ force: true });
    };
    gladys.onDeviceCreated(onAdded);
    gladys.onDeviceUpdated(onAdded);

    gladys.onConfigUpdated(async (newConfig) => {
      logger.info('Configuration updated');
      await restart(newConfig);
    });

    gladys.onAction('test_connection', async () => {
      logger.info('Action: connection test');
      connection = null;
      await readNow();
      if (!snapshot || lastError) {
        throw new Error(
          lastError ? lastError[config.language] : pick(TEXT.notConfigured, config.language),
        );
      }
      return localized(TEXT.testOk, {
        site: snapshot.siteName,
        version: connection?.version ?? '?',
        devices: snapshot.devices.length,
        clients: snapshot.clients.length,
      });
    });
    gladys.onAction('set_poe', (fields) => commands.setPoe(fields));
    gladys.onAction('reboot_device', (fields) => commands.reboot(fields));
    gladys.onAction('set_ssid', (fields) => commands.setSsid(fields));

    gladys.onSceneAction('set_poe', async (fields) => {
      await commands.setPoe(fields);
    });
    gladys.onSceneAction('reboot_device', async (fields) => {
      await commands.reboot(fields);
    });
    gladys.onSceneAction('set_ssid', async (fields) => {
      await commands.setSsid(fields);
    });

    gladys.onWidgetGet(WIDGET.NETWORK, async ({ language }) =>
      buildNetworkContent({
        snapshot,
        language,
        configured: isConfigured(config),
        error: lastError,
      }),
    );

    gladys.on('connected', async () => {
      try {
        await restart(await gladys.getConfig());
      } catch (err) {
        logger.error(`Post-connection initialization failed (${err.message})`);
        await gladys.setConnectionStatus(false, localized(TEXT.initFailed)).catch(() => {});
      }
    });
  }

  return {
    register,
    restart,
    readNow,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
    /** For the tests. */
    get snapshot() {
      return snapshot;
    },
    get config() {
      return config;
    },
  };
}
