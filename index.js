// -----------------------------------------------------------------------------
// Entry point of the TP-Link Omada integration for Gladys Assistant.
//
// SDK wiring only: the integration itself lives in src/app.js. The supervisor
// provides GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR; the SDK reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp({ gladys, dataDir: '/data' });

// Handlers are registered before connect(), as the SDK requires.
app.register();

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, shutting down`);
  app.stop();
});

logger.info('Starting the TP-Link Omada integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection to Gladys failed (${err.message})`);
  process.exit(1);
});
