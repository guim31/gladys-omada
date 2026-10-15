#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Omada controller, for the maintainers: does it
// answer like the integration expects?
//
//   node scripts/probe.mjs <controller-url> [--insecure]
//   node scripts/probe.mjs https://192.0.2.10:8043 --insecure
//
// It runs the real connection path up to the refusal of a FAKE account, and
// changes nothing on the controller:
//   1. GET /api/info (no login): version and Omada ID (masked);
//   2. Open API token request with an invented client ID / secret: the
//      controller must refuse it with error -44106;
//   3. web API login with an invented account: the controller must refuse it
//      with error -30109.
// Nothing sensitive is printed: no real credential is ever sent, the Omada ID
// is masked, and no address other than the one given is contacted.
// -----------------------------------------------------------------------------

import { normalizeBaseUrl, requestJson } from '../src/omada/http.js';

const args = process.argv.slice(2);
const insecure = args.includes('--insecure');
const url = normalizeBaseUrl(args.find((arg) => !arg.startsWith('--')) ?? '');
if (!url) {
  console.error('usage: node scripts/probe.mjs <controller-url> [--insecure]');
  process.exit(2);
}

const mask = (id) =>
  typeof id === 'string' && id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '?';
let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
};

async function step(label, run) {
  try {
    await run();
  } catch (err) {
    report(false, label, err.certificate ? `${err.message} (try --insecure)` : err.message);
  }
}

let omadacId = null;

await step('controller info (/api/info)', async () => {
  const res = await requestJson({ url: `${url}/api/info`, insecure });
  const result = res.json?.result;
  omadacId = result?.omadacId ?? null;
  report(
    res.status === 200 && Boolean(omadacId),
    'controller info (/api/info)',
    `HTTP ${res.status}, version ${result?.controllerVer ?? '?'}, API ${result?.apiVer ?? '?'}, ` +
      `type ${result?.type ?? '?'}, Omada ID ${mask(omadacId)}`,
  );
});

if (omadacId) {
  await step('Open API refuses an invented application', async () => {
    const res = await requestJson({
      url: `${url}/openapi/authorize/token?grant_type=client_credentials`,
      method: 'POST',
      body: {
        omadacId,
        client_id: 'gladys-probe-fake-id',
        client_secret: 'gladys-probe-fake-secret',
      },
      insecure,
    });
    const code = res.json?.errorCode;
    report(
      code === -44106,
      'Open API refuses an invented application',
      `HTTP ${res.status}, errorCode ${code ?? 'none'} (expected -44106)`,
    );
  });

  await step('web API refuses an invented account', async () => {
    const res = await requestJson({
      url: `${url}/${omadacId}/api/v2/login`,
      method: 'POST',
      body: { username: 'gladys-probe-fake-user', password: 'gladys-probe-fake-password' },
      headers: { Referer: `${url}/`, Origin: url },
      insecure,
    });
    const code = res.json?.errorCode;
    report(
      code === -30109 || (typeof code === 'number' && code !== 0),
      'web API refuses an invented account',
      `HTTP ${res.status}, errorCode ${code ?? 'none'} (expected -30109)`,
    );
  });
}

process.exit(failures === 0 ? 0 : 1);
