// -----------------------------------------------------------------------------
// Presence of the network clients, with a departure delay.
//
// A phone in deep sleep leaves the Wi-Fi for a few minutes: it is reported
// away only once it has been missing from the controller's list for longer
// than the configured delay. Presence is only evaluated on a successful read:
// a controller that does not answer never makes anybody leave.
// -----------------------------------------------------------------------------

export function createPresence() {
  /** Last time each client was in the controller's list (epoch ms). */
  const lastSeen = new Map();
  /** The clients of the latest successful read. */
  let current = new Set();

  return {
    /**
     * A client Gladys last knew as present, at startup: it gets the full
     * delay to show up in the first read, instead of leaving at once.
     * @param {string} mac
     * @param {number} at
     */
    seed(mac, at) {
      if (!lastSeen.has(mac)) {
        lastSeen.set(mac, at);
      }
    },

    /** @param {import('./omada/model.js').Snapshot} snapshot */
    update(snapshot) {
      current = new Set(snapshot.clients.map((client) => client.mac));
      for (const mac of current) {
        lastSeen.set(mac, snapshot.at);
      }
    },

    /**
     * 1 when the client is connected, or was less than `delayMinutes` ago.
     * @param {string} mac
     * @param {number} delayMinutes
     * @param {number} now
     */
    presenceOf(mac, delayMinutes, now) {
      if (current.has(mac)) {
        return 1;
      }
      const seen = lastSeen.get(mac);
      return seen !== undefined && now - seen < delayMinutes * 60000 ? 1 : 0;
    },
  };
}
