// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults (they
// MUST match the manifest `default` values, test/manifest.test.js checks it)
// and normalizes the received object, so the rest of the code never deals with
// `undefined` nor with a number typed as a string.
// -----------------------------------------------------------------------------

/** Languages of the feature names and of the texts the container produces. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const AUTH_MODES = ['openapi', 'local_account'];

/** Refresh intervals offered, in seconds (select values are strings). */
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  controller_url: '',
  auth_mode: 'openapi',
  client_id: '',
  client_secret: '',
  username: '',
  password: '',
  site: 'Default',
  omadac_id: '',
  accept_self_signed: false,
  poll_interval: '60',
  discover_clients: true,
  away_delay: 5,
  allow_poe_control: false,
  allow_reboot: false,
  allow_ssid_control: false,
  language: 'fr',
};

/** The config keys that hold a secret: never logged, never shown. */
export const SECRET_KEYS = ['client_secret', 'password'];

const str = (value, fallback) =>
  typeof value === 'string' ? value.trim() : value == null ? fallback : String(value).trim();

const bool = (value, fallback) =>
  typeof value === 'boolean'
    ? value
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : fallback;

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const key of ['controller_url', 'client_id', 'username', 'site', 'omadac_id']) {
    config[key] = str(raw[key], DEFAULT_CONFIG[key]);
  }
  // Secrets are kept as typed: a password may start or end with a space.
  for (const key of SECRET_KEYS) {
    config[key] = typeof raw[key] === 'string' ? raw[key] : DEFAULT_CONFIG[key];
  }
  config.auth_mode = AUTH_MODES.includes(raw.auth_mode) ? raw.auth_mode : DEFAULT_CONFIG.auth_mode;
  config.poll_interval = POLL_INTERVALS.includes(String(raw.poll_interval))
    ? String(raw.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  config.language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  for (const key of [
    'accept_self_signed',
    'discover_clients',
    'allow_poe_control',
    'allow_reboot',
    'allow_ssid_control',
  ]) {
    config[key] = bool(raw[key], DEFAULT_CONFIG[key]);
  }
  const delay = Number(raw.away_delay ?? DEFAULT_CONFIG.away_delay);
  config.away_delay = Number.isFinite(delay)
    ? Math.min(120, Math.max(0, Math.round(delay)))
    : DEFAULT_CONFIG.away_delay;
  return config;
}

/** Whether the config holds what the chosen mode needs to connect. */
export function isConfigured(config) {
  if (!config.controller_url) {
    return false;
  }
  return config.auth_mode === 'openapi'
    ? Boolean(config.client_id && config.client_secret)
    : Boolean(config.username && config.password);
}

/** Milliseconds between two reads of the controller. */
export function pollIntervalMs(config) {
  return Number(config.poll_interval) * 1000;
}

/** The config values to hide wherever text built from them could leak. */
export function secretValues(config) {
  return SECRET_KEYS.map((key) => config[key]).filter(
    (value) => typeof value === 'string' && value.length >= 4,
  );
}
