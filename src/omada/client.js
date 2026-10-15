// -----------------------------------------------------------------------------
// The controller client of the configured mode: the official Open API
// (recommended, the only one that sends commands) or the web API with a local
// account (read-only).
// -----------------------------------------------------------------------------

import { createOpenApiClient } from './openapi.js';
import { createWebApiClient } from './webapi.js';

/**
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 * @param {{ send?: Function, now?: () => number }} [deps]
 */
export function createOmadaClient(config, deps = {}) {
  const common = {
    url: config.controller_url,
    insecure: config.accept_self_signed,
    ...deps,
  };
  if (config.auth_mode === 'local_account') {
    return createWebApiClient({ ...common, username: config.username, password: config.password });
  }
  return createOpenApiClient({
    ...common,
    clientId: config.client_id,
    clientSecret: config.client_secret,
    omadacId: config.omadac_id,
  });
}
