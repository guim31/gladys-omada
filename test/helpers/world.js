// -----------------------------------------------------------------------------
// A complete test world: the fake Omada controller, the SDK's fake Gladys and
// the integration, wired like index.js does, without timers (the tests drive
// the reads) and with a logger that records every line.
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createOmadaClient } from '../../src/omada/client.js';
import { createPacedRequest } from '../../src/omada/base.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  PASSWORD,
  USERNAME,
  createOmadaState,
  startFakeOmada,
} from './fakeOmada.js';

export function createRecordingLogger() {
  const lines = [];
  const at =
    (level) =>
    (...args) => {
      lines.push({
        level,
        text: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      });
    };
  return {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => createRecordingLogger(),
    /** The lines of a level and above. */
    at(level) {
      const order = ['debug', 'info', 'warn', 'error'];
      return lines.filter((l) => order.indexOf(l.level) >= order.indexOf(level));
    },
  };
}

/**
 * @param {object} [options]
 * @param {'openapi'|'local_account'} [options.mode]
 * @param {object} [options.config] overrides of the integration config
 * @param {object[]} [options.devices] devices "created by the user" in Gladys
 * @param {ReturnType<typeof createOmadaState>} [options.state]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the refresh timer
 * @param {boolean} [options.connect] connect Gladys at once
 * @param {string} [options.dataDir] reuse a /data of a previous world (kept on close)
 */
export async function createWorld({
  mode = 'openapi',
  config = {},
  devices = [],
  state,
  now,
  timers = false,
  connect = true,
  dataDir: givenDataDir,
} = {}) {
  const omada = await startFakeOmada({ state: state ?? createOmadaState() });
  const dataDir = givenDataDir ?? (await mkdtemp(path.join(tmpdir(), 'omada-test-')));
  const fullConfig = {
    controller_url: omada.url,
    auth_mode: mode,
    site: mode === 'openapi' ? 'Default' : 'Test',
    ...(mode === 'openapi'
      ? { client_id: CLIENT_ID, client_secret: CLIENT_SECRET }
      : { username: USERNAME, password: PASSWORD }),
    ...config,
  };
  const gladys = createFakeGladys({ config: fullConfig, devices });
  const logger = createRecordingLogger();
  // No pacing between requests: the fake controller has no budget to protect.
  const createClient = (cfg) =>
    createOmadaClient(cfg, { send: createPacedRequest({ minIntervalMs: 0 }) });
  const app = createApp({ gladys, dataDir, timers, logger, createClient, ...(now ? { now } : {}) });
  app.register();
  if (connect) {
    await gladys.connect();
  }

  return {
    omada,
    gladys,
    app,
    logger,
    dataDir,
    config: fullConfig,
    /** The devices of the Discovery tab, "added to Gladys" (all, or the filtered ones). */
    async addDevices(filter = () => true) {
      const chosen = gladys.fake.discoveredDevices.filter(filter);
      for (const device of chosen) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      return chosen;
    },
    async close() {
      app.stop();
      await gladys.disconnect();
      await omada.close();
      if (!givenDataDir) {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}
