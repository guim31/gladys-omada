// -----------------------------------------------------------------------------
// Scene triggers, from the difference between two successive reads.
//
// - new_unknown_client: a MAC address never seen on the site joins the network
//   (an alert that has no device state to hang on: the client is unknown).
// - device_offline: an Omada device goes offline. Unlike its "online" feature,
//   it covers every device of the site without adding them all to Gladys, and
//   carries the name and model for the notification text.
// - wan_changed: a WAN port loses or gets back Internet, with the port and
//   the gateway in the variables.
//
// Only transitions fire: the first read after a (re)connection only sets the
// reference, so a restart of the container or of the controller never fires.
// -----------------------------------------------------------------------------

import { CLIENT, EQUIPMENT } from './devices.js';
import { macApi } from './omada/model.js';

export const TRIGGER = {
  NEW_CLIENT: 'new_unknown_client',
  DEVICE_OFFLINE: 'device_offline',
  WAN_CHANGED: 'wan_changed',
};

/**
 * @param {object} gladys
 * @param {import('./omada/model.js').NetworkClient} client
 */
export function newClientEvent(gladys, client) {
  return {
    key: TRIGGER.NEW_CLIENT,
    data: {
      client: gladys.externalIds(CLIENT, client.mac).device,
      mac: macApi(client.mac),
      name: client.name,
      ip: client.ip,
      connection: client.wireless ? 'wireless' : 'wired',
      ssid: client.ssid,
      guest: client.guest ? 'yes' : 'no',
      connected_to: client.uplinkName,
    },
  };
}

/**
 * Events between two reads of the same site.
 * @param {object} gladys
 * @param {import('./omada/model.js').Snapshot | null} previous
 * @param {import('./omada/model.js').Snapshot} current
 * @returns {Array<{ key: string, data: Record<string, string|number|boolean|null> }>}
 */
export function transitionEvents(gladys, previous, current) {
  if (!previous || previous.siteId !== current.siteId) {
    return [];
  }
  const events = [];
  const before = new Map(previous.devices.map((device) => [device.mac, device]));
  for (const device of current.devices) {
    if (before.get(device.mac)?.online === true && !device.online) {
      events.push({
        key: TRIGGER.DEVICE_OFFLINE,
        data: {
          device: gladys.externalIds(EQUIPMENT, device.mac).device,
          device_name: device.name,
          device_type: device.type,
          model: device.model,
          mac: macApi(device.mac),
        },
      });
    }
  }
  const wanKey = (wan) => `${wan.gateway}:${wan.port}`;
  const wansBefore = new Map(previous.wans.map((wan) => [wanKey(wan), wan]));
  const names = new Map(current.devices.map((device) => [device.mac, device.name]));
  for (const wan of current.wans) {
    const old = wansBefore.get(wanKey(wan));
    if (old && old.online !== wan.online) {
      events.push({
        key: TRIGGER.WAN_CHANGED,
        data: {
          state: wan.online ? 'up' : 'down',
          gateway: gladys.externalIds(EQUIPMENT, wan.gateway).device,
          gateway_name: names.get(wan.gateway) ?? macApi(wan.gateway),
          port_name: wan.label,
          ip: wan.online ? wan.ip : null,
        },
      });
    }
  }
  return events;
}
