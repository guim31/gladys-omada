// -----------------------------------------------------------------------------
// The "network" dashboard widget: clients, Internet throughput, the state of
// each WAN port and of the Omada devices, at a glance.
//
// Built from the latest read of the controller, never from a request of its
// own: opening a dashboard costs the controller nothing. Pre-localized from
// the `language` of the request (the core caches per language).
// Budget of the core: 8 components, 6 tiles, 1 status list.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_TEXT, pick } from './i18n.js';

export const WIDGET = { NETWORK: 'network' };

const MAX_STATUS_ROWS = 10;

const tile = (label, value, icon, unit) => ({
  type: 'value',
  label,
  value,
  icon,
  ...(unit ? { unit } : {}),
});

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * @param {object} options
 * @param {import('./omada/model.js').Snapshot | null} options.snapshot
 * @param {string} options.language
 * @param {boolean} options.configured
 * @param {object | null} [options.error] the reason of the last failed read (multi-language)
 */
export function buildNetworkContent({ snapshot, language, configured, error = null }) {
  const t = (key) => pick(WIDGET_TEXT[key], language);
  if (!configured) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: t('notConfigured') }] };
  }
  if (!snapshot) {
    if (error) {
      return { ttl_seconds: 30, components: [{ type: 'text', text: error[language] ?? error.en }] };
    }
    return {
      ttl_seconds: 30,
      components: [{ type: 'text', variant: 'caption', text: t('waiting') }],
    };
  }

  const wireless = snapshot.clients.filter((client) => client.wireless).length;
  const wans = snapshot.wans;
  // KB/s on the controller side, Mbit/s on the tile.
  const sum = (key) => round1((wans.reduce((total, wan) => total + (wan[key] ?? 0), 0) * 8) / 1000);

  const components = [
    tile(t('clients'), snapshot.clients.length, 'users'),
    tile(t('wifi'), wireless, 'wifi'),
    tile(t('wired'), snapshot.clients.length - wireless, 'server'),
  ];
  if (wans.length > 0) {
    components.push(
      tile(t('download'), sum('download'), 'download', 'Mbit/s'),
      tile(t('upload'), sum('upload'), 'upload', 'Mbit/s'),
    );
  }

  const items = [];
  for (const wan of wans) {
    items.push({
      label: wan.label,
      value: wan.online
        ? [t('online'), wan.ip].filter(Boolean).join(' · ').slice(0, 40)
        : t(wan.linkUp ? 'noInternet' : 'noLink'),
      color: wan.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      icon: 'globe',
    });
  }
  const online = snapshot.devices.filter((device) => device.online).length;
  if (snapshot.devices.length > 0) {
    items.push({
      label: t('devices'),
      value: `${online}/${snapshot.devices.length}`,
      color: online === snapshot.devices.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
      icon: 'server',
    });
  }
  for (const device of snapshot.devices.filter((d) => !d.online)) {
    if (items.length >= MAX_STATUS_ROWS) break;
    items.push({
      label: device.name.slice(0, 40),
      value: t('offline'),
      color: WIDGET_COLORS.DANGER,
      icon: 'alert-triangle',
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  return { ttl_seconds: 60, components };
}
