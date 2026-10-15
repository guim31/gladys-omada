// -----------------------------------------------------------------------------
// One data model for both APIs.
//
// The Open API (official, client credentials) and the web API (local admin
// account, the one the Omada web interface and Home Assistant use) describe
// the same objects with small differences. The main trap: a device `status`
// is 0/1 (offline/online) in the Open API, but a detail code (14 = connected)
// in the web API, whose 0/1 is `statusCategory`. Everything past this module
// reads the normalized shapes only.
// -----------------------------------------------------------------------------

/** The equipment types the integration handles. */
export const EQUIPMENT_TYPES = ['gateway', 'switch', 'ap'];

/**
 * A MAC in the form used for identifiers: 12 lowercase hex digits, or null.
 * @param {unknown} mac
 */
export function macKey(mac) {
  const hex = String(mac ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex : null;
}

/**
 * A MAC in the controller's form (AA-BB-CC-DD-EE-FF), used in the API paths.
 * @param {unknown} mac
 */
export function macApi(mac) {
  const key = macKey(mac);
  return key ? key.toUpperCase().match(/../g).join('-') : null;
}

const num = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/**
 * Uptime in seconds: `uptimeLong` (web API) or the display string of the
 * Open API ("3day(s) 4h 12m 9s").
 * @param {Record<string, unknown>} raw
 */
export function parseUptime(raw) {
  const long = num(raw.uptimeLong);
  if (long !== null) {
    return long;
  }
  if (typeof raw.uptime === 'number') {
    return num(raw.uptime);
  }
  const display = text(raw.uptime);
  if (!display) {
    return null;
  }
  const units = { day: 86400, h: 3600, m: 60, s: 1 };
  let seconds = 0;
  let found = false;
  for (const match of display.matchAll(/(\d+)\s*(day|h|m|s)/g)) {
    seconds += Number(match[1]) * units[match[2]];
    found = true;
  }
  return found ? seconds : null;
}

/**
 * @typedef {object} Equipment
 * @property {string} mac 12 hex digits
 * @property {string} type gateway | switch | ap
 * @property {string} name
 * @property {string|null} model
 * @property {string|null} ip
 * @property {boolean} online
 * @property {number|null} uptime seconds
 * @property {number|null} cpu percent
 * @property {number|null} memory percent
 * @property {string|null} firmware
 */

function deviceName(raw, mac) {
  const name = text(raw.name);
  if (name && macKey(name) !== mac) {
    return name;
  }
  const model = text(raw.modelName) ?? text(raw.model);
  return model ? `${model} ${macApi(mac).slice(-5)}` : macApi(mac);
}

/**
 * @param {Record<string, unknown>} raw a device of either API
 * @returns {Equipment|null}
 */
export function normalizeDevice(raw) {
  const mac = macKey(raw?.mac);
  const type = String(raw?.type ?? '').toLowerCase();
  if (!mac || !EQUIPMENT_TYPES.includes(type)) {
    return null;
  }
  const online =
    raw.statusCategory !== undefined ? num(raw.statusCategory) === 1 : num(raw.status) === 1;
  return {
    mac,
    type,
    // A device never named in the controller carries its MAC as name: the
    // model and the end of the MAC say more.
    name: deviceName(raw, mac),
    model: text(raw.modelName) ?? text(raw.model) ?? text(raw.showModel),
    ip: text(raw.ip),
    online,
    // An offline device reports stale counters: none of them is a reading.
    uptime: online ? parseUptime(raw) : null,
    cpu: online ? num(raw.cpuUtil) : null,
    memory: online ? num(raw.memUtil) : null,
    firmware: text(raw.firmwareVersion),
  };
}

/**
 * @typedef {object} NetworkClient
 * @property {string} mac 12 hex digits
 * @property {string} name
 * @property {string|null} ip
 * @property {boolean} wireless
 * @property {string|null} ssid
 * @property {boolean} guest
 * @property {string|null} uplink MAC (12 hex) of the AP, switch or gateway it is connected to
 * @property {string|null} uplinkName
 * @property {number|null} download bytes/s (real-time "activity")
 * @property {number|null} upload bytes/s
 */

/**
 * @param {Record<string, unknown>} raw a connected client of either API
 * @returns {NetworkClient|null}
 */
export function normalizeClient(raw) {
  const mac = macKey(raw?.mac);
  if (!mac || raw.active === false) {
    return null;
  }
  const wireless = raw.wireless === true;
  const via = wireless
    ? ['apMac', 'apName']
    : {
        switch: ['switchMac', 'switchName'],
        gateway: ['gatewayMac', 'gatewayName'],
        ap: ['apMac', 'apName'],
      }[String(raw.connectDevType ?? '').toLowerCase()];
  const name = text(raw.name);
  return {
    mac,
    // The controller names an unnamed client after its MAC: the host name says more.
    name: name && macKey(name) !== mac ? name : (text(raw.hostName) ?? name ?? macApi(mac)),
    ip: text(raw.ip),
    wireless,
    ssid: wireless ? text(raw.ssid) : null,
    guest: raw.guest === true,
    uplink: via ? macKey(raw[via[0]]) : null,
    uplinkName: via ? text(raw[via[1]]) : null,
    download: num(raw.activity),
    upload: num(raw.uploadActivity),
  };
}

/**
 * @typedef {object} WanPort
 * @property {string} gateway MAC (12 hex) of the gateway
 * @property {number} port
 * @property {string} name port name given by the controller
 * @property {string} label description typed in the controller, or the name
 * @property {boolean} linkUp cable / link up
 * @property {boolean} online Internet reachable through the port
 * @property {string|null} ip
 * @property {number|null} download KB/s
 * @property {number|null} upload KB/s
 */

/**
 * The WAN ports of a gateway: the Open API `wan-status` list or the web API
 * `portStats`. A port in WAN mode has `mode` 0; a fixed LAN port has none.
 * @param {string} gatewayMac
 * @param {Array<Record<string, unknown>>} ports
 * @returns {WanPort[]}
 */
export function normalizeWanPorts(gatewayMac, ports) {
  const gateway = macKey(gatewayMac);
  if (!gateway || !Array.isArray(ports)) {
    return [];
  }
  return ports
    .map((port, index) => ({ port, number: num(port?.port) ?? num(port?.portId) ?? index + 1 }))
    .filter(({ port }) => port && num(port.mode) === 0)
    .map(({ port, number }) => {
      const linkUp = num(port.status) === 1;
      return {
        gateway,
        port: number,
        // The controller's port name (WAN1, SFP WAN/LAN1) names the features;
        // the description the user typed in the controller labels the widget.
        name: text(port.portName) ?? text(port.name) ?? `WAN${number}`,
        label: text(port.portDesc) ?? text(port.portName) ?? text(port.name) ?? `WAN${number}`,
        linkUp,
        online: linkUp && num(port.internetState) === 1,
        ip: text(port.ip) ?? text(port.wanPortIpv4Config?.ip),
        download: linkUp ? num(port.rxRate) : 0,
        upload: linkUp ? num(port.txRate) : 0,
      };
    })
    .sort((a, b) => a.port - b.port);
}

/**
 * @typedef {object} Snapshot
 * @property {string} siteId
 * @property {string} siteName
 * @property {Equipment[]} devices
 * @property {NetworkClient[]} clients
 * @property {WanPort[]} wans
 * @property {Map<string, number>} poe PoE power drawn per switch MAC, in watts
 * @property {number} at epoch ms
 */
