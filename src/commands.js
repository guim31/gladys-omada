// -----------------------------------------------------------------------------
// Commands: PoE of a switch port, restart of a device, SSID on/off.
//
// Each one is off by default (its own option in the configuration), needs the
// Open API mode, and is an action — a button of the Configuration screen or a
// scene action — never a device switch: cutting the PoE of a port can switch
// off a security camera, a restart cuts the network for minutes. One info
// line per command, never a secret.
// -----------------------------------------------------------------------------

import { TEXT, localized, pick, reasonOf } from './i18n.js';
import { EQUIPMENT, parseDeviceId } from './devices.js';

/** Thrown for a refused command: `message` in the configured language. */
export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {() => object} options.getConfig
 * @param {() => Promise<{ client: object, site: object, snapshot: object | null }>} options.session
 *   the connected controller client, its site and the latest read
 * @param {() => void} options.refresh read the controller again soon
 * @param {{ info: Function }} options.logger
 */
export function createCommands({ gladys, getConfig, session, refresh, logger }) {
  const fail = (entry, vars) => {
    throw new CommandError(pick(entry, getConfig().language, vars));
  };

  async function ready(option, disabledText) {
    const config = getConfig();
    if (config.auth_mode !== 'openapi') {
      fail(TEXT.readOnlyMode);
    }
    if (!config[option]) {
      fail(disabledText);
    }
    const state = await session();
    if (!state.snapshot) {
      fail(TEXT.notReady);
    }
    return state;
  }

  function equipmentOf(snapshot, deviceExternalId) {
    const parsed = parseDeviceId(gladys, deviceExternalId);
    if (!parsed || parsed.kind !== EQUIPMENT) {
      fail(TEXT.notEquipment);
    }
    const equipment = snapshot.devices.find((device) => device.mac === parsed.mac);
    if (!equipment) {
      fail(TEXT.unknownDevice);
    }
    return equipment;
  }

  function onOff(value) {
    if (value === 'on' || value === true) return true;
    if (value === 'off' || value === false) return false;
    return fail(TEXT.invalidState);
  }

  async function run(work) {
    try {
      return await work();
    } catch (err) {
      if (err instanceof CommandError) throw err;
      const reason = reasonOf(err)[getConfig().language] ?? reasonOf(err).en;
      throw new CommandError(pick(TEXT.commandFailed, getConfig().language, { reason }));
    }
  }

  return {
    /** @param {{ device: string, port: number|string, state: string }} fields */
    async setPoe(fields) {
      const { client, site, snapshot } = await ready('allow_poe_control', TEXT.poeDisabled);
      const on = onOff(fields.state);
      const port = Number(fields.port);
      if (!Number.isInteger(port) || port < 1 || port > 128) {
        fail(TEXT.invalidPort);
      }
      const sw = equipmentOf(snapshot, fields.device);
      if (sw.type !== 'switch') {
        fail(TEXT.notSwitch, { device: sw.name });
      }
      if (!sw.online) {
        fail(TEXT.offline, { device: sw.name });
      }
      await run(() => client.setPoe(site, sw.mac, port, on));
      logger.info(`Command: PoE ${on ? 'on' : 'off'} on port ${port} of ${sw.name}`);
      refresh();
      return localized(on ? TEXT.poeOn : TEXT.poeOff, { port, device: sw.name });
    },

    /** @param {{ device: string }} fields */
    async reboot(fields) {
      const { client, site, snapshot } = await ready('allow_reboot', TEXT.rebootDisabled);
      const equipment = equipmentOf(snapshot, fields.device);
      if (!equipment.online) {
        fail(TEXT.offline, { device: equipment.name });
      }
      await run(() => client.reboot(site, equipment.mac));
      logger.info(`Command: restart of ${equipment.name}`);
      refresh();
      return localized(TEXT.rebootDone, { device: equipment.name });
    },

    /** @param {{ ssid: string, state: string }} fields */
    async setSsid(fields) {
      const { client, site, snapshot } = await ready('allow_ssid_control', TEXT.ssidDisabled);
      const on = onOff(fields.state);
      const ssid = String(fields.ssid ?? '').trim();
      const accessPoints = snapshot.devices.filter((d) => d.type === 'ap' && d.online);
      const count = ssid ? await run(() => client.setSsid(site, accessPoints, ssid, on)) : 0;
      if (count === 0) {
        const known = await run(() => client.ssids(site, accessPoints));
        fail(TEXT.ssidUnknown, { ssid, list: [...known.keys()].join(', ') || '-' });
      }
      logger.info(`Command: SSID ${ssid} ${on ? 'enabled' : 'disabled'} on ${count} AP(s)`);
      return localized(on ? TEXT.ssidOn : TEXT.ssidOff, { ssid, count });
    },
  };
}
