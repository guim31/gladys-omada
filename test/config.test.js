import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DEFAULT_CONFIG,
  isConfigured,
  normalizeConfig,
  pollIntervalMs,
  secretValues,
} from '../src/config.js';
import { startFakeOmada } from './helpers/fakeOmada.js';

test('an empty config is the defaults, commands off', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(normalizeConfig().allow_poe_control, false);
  assert.equal(normalizeConfig().language, 'fr');
});

test('types are forced, unknown values fall back to the defaults', () => {
  const config = normalizeConfig({
    controller_url: ' https://192.0.2.10:8043 ',
    auth_mode: 'cloud',
    poll_interval: 120,
    away_delay: '7.6',
    language: 'it',
    accept_self_signed: 'true',
    allow_reboot: 'false',
  });
  assert.equal(config.controller_url, 'https://192.0.2.10:8043');
  assert.equal(config.auth_mode, 'openapi');
  assert.equal(config.poll_interval, '120');
  assert.equal(pollIntervalMs(config), 120000);
  assert.equal(config.away_delay, 8);
  assert.equal(config.language, 'fr');
  assert.equal(config.accept_self_signed, true);
  assert.equal(config.allow_reboot, false);
  assert.equal(normalizeConfig({ away_delay: 999 }).away_delay, 120);
  assert.equal(normalizeConfig({ poll_interval: '5' }).poll_interval, '60');
});

test('a secret is kept as typed, spaces included', () => {
  assert.equal(normalizeConfig({ password: ' pass ' }).password, ' pass ');
  assert.deepEqual(secretValues(normalizeConfig({ client_secret: 'abcd', password: 'x' })), [
    'abcd',
  ]);
});

test('configured: the address and the credentials of the chosen mode', () => {
  const url = 'https://192.0.2.10';
  assert.equal(isConfigured(normalizeConfig({ controller_url: url })), false);
  assert.equal(
    isConfigured(normalizeConfig({ controller_url: url, client_id: 'a', client_secret: 'b' })),
    true,
  );
  assert.equal(
    isConfigured(
      normalizeConfig({
        controller_url: url,
        auth_mode: 'local_account',
        client_id: 'a',
        client_secret: 'b',
      }),
    ),
    false,
  );
  assert.equal(
    isConfigured(
      normalizeConfig({
        controller_url: url,
        auth_mode: 'local_account',
        username: 'a',
        password: 'b',
      }),
    ),
    true,
  );
});

test('scripts/probe.mjs reads only, and is refused with invented credentials', async () => {
  const omada = await startFakeOmada();
  try {
    const { stdout } = await promisify(execFile)('node', [
      new URL('../scripts/probe.mjs', import.meta.url).pathname,
      omada.url,
    ]);
    assert.match(stdout, /OK {3}controller info/);
    assert.match(stdout, /Omada ID 0123…cdef/);
    assert.match(stdout, /errorCode -44106/);
    assert.match(stdout, /errorCode -30109/);
    assert.ok(!stdout.includes('0123456789abcdef0123456789abcdef'), 'the Omada ID is masked');
    assert.deepEqual(
      omada.requests.map((r) => r.method),
      ['GET', 'POST', 'POST'],
      'info, one refused token request, one refused login: nothing else',
    );
  } finally {
    await omada.close();
  }
});
