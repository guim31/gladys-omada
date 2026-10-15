// -----------------------------------------------------------------------------
// The Gladys devices built from a snapshot of the Omada site.
//
// - One device per gateway, switch and access point ("equipment"), keyed on
//   its MAC: online, connected clients, uptime, CPU, memory, plus the client
//   throughput of a switch or an access point, the PoE power of a PoE switch,
//   and the state and throughput of each WAN port of a gateway.
// - One device per network client ("client"), keyed on its MAC: a presence
//   sensor. The user adds the ones to follow from the Discovery tab.
//
// External ids are forever: `ext:<selector>:equipment:<mac>` and
// `ext:<selector>:client:<mac>`, MAC in 12 lowercase hex digits. A feature
// never moves from one device to another (CLAUDE.md, the UniFi lesson).
//
// Everything is read-only: the commands (PoE, restart, SSID) are actions, on
// purpose never switches a voice assistant or a misclick could flip.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES, format } from './i18n.js';
import { macApi } from './omada/model.js';

export const EQUIPMENT = 'equipment';
export const CLIENT = 'client';

export const FEATURE = {
  ONLINE: 'online',
  CLIENTS: 'clients',
  UPTIME: 'uptime',
  CPU: 'cpu',
  MEMORY: 'memory',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  POE: 'poe_power',
  PRESENCE: 'presence',
};

/** Feature key of a WAN port: `wan<port>_online`, `wan<port>_download`... */
export const wanFeature = (port, what) => `wan${port}_${what}`;

const MODEL_LABEL = { gateway: 'Gateway', switch: 'Switch', ap: 'Access point' };

// Gladys schedules the fallback onPoll once a minute; the container's own
// timer does the work (src/poller.js).
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

const sensor = (externalId, name, category, type, { unit, min = 0, max } = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const onlineFeature = (id, name) =>
  sensor(id, name, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    max: 1,
  });

const rateFeature = (id, name) =>
  sensor(id, name, DEVICE_FEATURE_CATEGORIES.DATARATE, DEVICE_FEATURE_TYPES.DATARATE.RATE, {
    unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND,
    max: 100000,
  });

const percentFeature = (id, name) =>
  sensor(id, name, DEVICE_FEATURE_CATEGORIES.UNKNOWN, DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN, {
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    max: 100,
  });

const names = (config) => NAMES[config.language] ?? NAMES.en;

/**
 * @param {object} gladys GladysIntegration
 * @param {import('./omada/model.js').Equipment} equipment
 * @param {import('./omada/model.js').Snapshot} snapshot
 * @param {object} config normalized config
 */
export function buildEquipmentDevice(gladys, equipment, snapshot, config) {
  const ids = gladys.externalIds(EQUIPMENT, equipment.mac);
  const n = names(config);
  const features = [
    onlineFeature(ids.feature(FEATURE.ONLINE), n.online),
    sensor(
      ids.feature(FEATURE.CLIENTS),
      n.clients,
      DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      { max: 10000 },
    ),
    sensor(
      ids.feature(FEATURE.UPTIME),
      n.uptime,
      DEVICE_FEATURE_CATEGORIES.DURATION,
      DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      // Hours: the value changes once an hour, not at every reading.
      { unit: DEVICE_FEATURE_UNITS.HOURS, max: 1000000 },
    ),
    percentFeature(ids.feature(FEATURE.CPU), n.cpu),
    percentFeature(ids.feature(FEATURE.MEMORY), n.memory),
  ];
  if (equipment.type === 'switch' || equipment.type === 'ap') {
    features.push(
      rateFeature(ids.feature(FEATURE.DOWNLOAD), n.download),
      rateFeature(ids.feature(FEATURE.UPLOAD), n.upload),
    );
  }
  if (equipment.type === 'switch' && snapshot.poe.has(equipment.mac)) {
    features.push(
      sensor(
        ids.feature(FEATURE.POE),
        n.poe,
        DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
        { unit: DEVICE_FEATURE_UNITS.WATT, max: 10000 },
      ),
    );
  }
  if (equipment.type === 'gateway') {
    for (const wan of snapshot.wans.filter((w) => w.gateway === equipment.mac)) {
      const port = { port: wan.name };
      features.push(
        onlineFeature(ids.feature(wanFeature(wan.port, 'online')), format(n.wanOnline, port)),
        rateFeature(ids.feature(wanFeature(wan.port, 'download')), format(n.wanDownload, port)),
        rateFeature(ids.feature(wanFeature(wan.port, 'upload')), format(n.wanUpload, port)),
      );
    }
  }
  const params = [{ name: 'MAC_ADDRESS', value: macApi(equipment.mac) }];
  if (equipment.ip) {
    params.push({ name: 'IP_ADDRESS', value: equipment.ip });
  }
  return {
    name: equipment.name,
    external_id: ids.device,
    model: [equipment.model, MODEL_LABEL[equipment.type]].filter(Boolean).join(' · '),
    ...POLLING,
    params,
    features,
  };
}

/**
 * @param {object} gladys
 * @param {{ mac: string, name: string }} client
 * @param {object} config
 */
export function buildClientDevice(gladys, client, config) {
  const ids = gladys.externalIds(CLIENT, client.mac);
  return {
    name: client.name,
    external_id: ids.device,
    model: 'Omada client',
    ...POLLING,
    params: [{ name: 'MAC_ADDRESS', value: macApi(client.mac) }],
    features: [
      sensor(
        ids.feature(FEATURE.PRESENCE),
        names(config).presence,
        DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { max: 1 },
      ),
    ],
  };
}

/**
 * Parse one of our device external ids.
 * @param {object} gladys
 * @param {string} externalId
 * @returns {{ kind: string, mac: string } | null}
 */
export function parseDeviceId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [kind, mac] = externalId.slice(prefix.length).split(':');
  if ((kind !== EQUIPMENT && kind !== CLIENT) || !/^[0-9a-f]{12}$/.test(mac ?? '')) {
    return null;
  }
  return { kind, mac };
}

/**
 * The devices of the Discovery tab: every equipment of the site, the clients
 * online now (when the option is on), and the clients already added to Gladys
 * even when they are away — the list replaces the previous one.
 * @param {object} gladys
 * @param {import('./omada/model.js').Snapshot} snapshot
 * @param {object} config
 */
export function buildDiscoveredDevices(gladys, snapshot, config) {
  const devices = snapshot.devices.map((equipment) =>
    buildEquipmentDevice(gladys, equipment, snapshot, config),
  );
  const clients = new Map();
  for (const device of gladys.devices ?? []) {
    const parsed = parseDeviceId(gladys, device.external_id);
    if (parsed?.kind === CLIENT) {
      clients.set(parsed.mac, { mac: parsed.mac, name: device.name });
    }
  }
  if (config.discover_clients) {
    for (const client of snapshot.clients) {
      if (!clients.has(client.mac)) {
        clients.set(client.mac, client);
      }
    }
  }
  for (const client of clients.values()) {
    devices.push(buildClientDevice(gladys, client, config));
  }
  return devices;
}

const mbps = (bytesPerSecond) => Math.round(((bytesPerSecond * 8) / 1e6) * 10) / 10;

/**
 * Every value the snapshot gives, by feature external id. Values that are
 * not known (an offline device's CPU) are absent, never invented.
 * @param {object} gladys
 * @param {import('./omada/model.js').Snapshot} snapshot
 * @param {(mac: string) => number} presenceOf 1 present, 0 away
 * @param {Iterable<string>} clientMacs the client devices to report
 * @returns {Map<string, number>}
 */
export function featureValues(gladys, snapshot, presenceOf, clientMacs) {
  const values = new Map();
  for (const equipment of snapshot.devices) {
    const ids = gladys.externalIds(EQUIPMENT, equipment.mac);
    const set = (key, value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        values.set(ids.feature(key), value);
      }
    };
    const connected = snapshot.clients.filter((client) => client.uplink === equipment.mac);
    set(FEATURE.ONLINE, equipment.online ? 1 : 0);
    if (!equipment.online) {
      continue;
    }
    set(FEATURE.CLIENTS, connected.length);
    set(FEATURE.UPTIME, equipment.uptime === null ? null : Math.floor(equipment.uptime / 3600));
    set(FEATURE.CPU, equipment.cpu);
    set(FEATURE.MEMORY, equipment.memory);
    if (equipment.type === 'switch' || equipment.type === 'ap') {
      const down = connected.map((c) => c.download).filter((v) => v !== null);
      const up = connected.map((c) => c.upload).filter((v) => v !== null);
      set(FEATURE.DOWNLOAD, mbps(down.reduce((a, b) => a + b, 0)));
      // Older controllers report no upload activity: no value rather than 0.
      if (up.length > 0 || connected.length === 0) {
        set(FEATURE.UPLOAD, mbps(up.reduce((a, b) => a + b, 0)));
      }
    }
    if (equipment.type === 'switch') {
      set(FEATURE.POE, snapshot.poe.get(equipment.mac));
    }
    for (const wan of snapshot.wans.filter((w) => w.gateway === equipment.mac)) {
      set(wanFeature(wan.port, 'online'), wan.online ? 1 : 0);
      // KB/s on the controller side.
      if (wan.download !== null) set(wanFeature(wan.port, 'download'), mbps(wan.download * 1000));
      if (wan.upload !== null) set(wanFeature(wan.port, 'upload'), mbps(wan.upload * 1000));
    }
  }
  for (const mac of clientMacs) {
    values.set(gladys.externalIds(CLIENT, mac).feature(FEATURE.PRESENCE), presenceOf(mac));
  }
  return values;
}
