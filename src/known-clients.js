// -----------------------------------------------------------------------------
// The clients already seen on each site, kept in /data across restarts: the
// "new unknown client" trigger fires for a MAC address never seen before.
//
// The first read of a site only learns (an install must not fire one event per
// client of the house), and so does a read that brings an unlikely number of
// new clients at once (a controller restored, another site configured).
// Only MAC addresses are stored: no name, no address.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** More new clients than this in one read: learnt silently. */
export const MAX_NEW_AT_ONCE = 20;

/**
 * @param {object} options
 * @param {string} options.dataDir the writable volume (/data)
 * @param {{ fail: Function, ok: Function }} options.issues
 */
export function createKnownClients({ dataDir, issues }) {
  const file = path.join(dataDir, 'known-clients.json');
  /** @type {Record<string, Set<string>> | null} */
  let sites = null;

  async function load() {
    if (sites) {
      return sites;
    }
    sites = {};
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      for (const [site, macs] of Object.entries(raw?.sites ?? {})) {
        if (Array.isArray(macs)) {
          sites[site] = new Set(macs.filter((mac) => /^[0-9a-f]{12}$/.test(mac)));
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        issues.fail('known-clients-read', `known clients: cannot read ${file} (${err.message})`);
      }
    }
    return sites;
  }

  async function save() {
    const body = {
      version: 1,
      sites: Object.fromEntries(
        Object.entries(sites).map(([site, set]) => [site, [...set].sort()]),
      ),
    };
    try {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8');
      await rename(tmp, file);
      issues.ok('known-clients-write', 'known clients: saved again');
    } catch (err) {
      // Kept in memory: the trigger works until the next restart.
      issues.fail('known-clients-write', `known clients: cannot write ${file} (${err.message})`);
    }
  }

  return {
    /**
     * Record the clients of a read; resolve the ones never seen before.
     * @param {string} siteId
     * @param {string[]} macs
     * @returns {Promise<{ fresh: string[], learnt: number }>}
     */
    async observe(siteId, macs) {
      const all = await load();
      const known = all[siteId];
      if (!known) {
        all[siteId] = new Set(macs);
        await save();
        return { fresh: [], learnt: macs.length };
      }
      const fresh = [...new Set(macs)].filter((mac) => !known.has(mac));
      if (fresh.length === 0) {
        return { fresh: [], learnt: 0 };
      }
      for (const mac of fresh) {
        known.add(mac);
      }
      await save();
      return fresh.length > MAX_NEW_AT_ONCE
        ? { fresh: [], learnt: fresh.length }
        : { fresh, learnt: 0 };
    },
  };
}
