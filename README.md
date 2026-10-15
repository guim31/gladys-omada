# TP-Link Omada for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows a
**TP-Link Omada** network — Software Controller, OC200 or OC300 — over the local network: who is home,
the access points, switches and gateway, the Internet connection, and a few commands for the scenes.

> **Developed without the hardware: feedback welcome.** The integration is built and tested against a
> fake controller made of published answers of real controllers (see the credits), not against a real
> controller yet. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-omada/issues).

Not affiliated with TP-Link. Omada and TP-Link are trademarks of TP-Link.

## Features

- **Presence**: every network client (a phone, a laptop) can be added from the Discovery tab as a
  presence sensor, with an adjustable departure delay. A controller that does not answer never makes
  anybody leave.
- **One device per gateway, switch and access point**: online, connected clients, uptime, CPU and
  memory usage, client throughput (switches and access points), PoE power drawn (PoE switches), and the
  Internet state and throughput of each WAN port (gateway).
- **Scene triggers**: _New unknown network client_ (a MAC address never seen on the site, with Wi-Fi /
  wired, SSID and guest-network filters), _Omada device offline_, _WAN down or back_.
- **Commands**, each **off by default**, Open API mode only, as Configuration screen buttons and scene
  actions — never as device switches: PoE of a switch port on / off, restart of an Omada device, SSID
  (the guest Wi-Fi) on / off. Cutting the PoE of a port switches off what it powers, a security camera
  included: the documentation says so.
- **Dashboard widget** "Omada network": clients, Internet throughput, WAN ports and the Omada devices
  offline.
- A **Test the connection** button, and a connection status that names the problem (credentials,
  certificate, site, role…).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- An Omada controller reachable from Gladys on the local network: Software Controller, OC200 or OC300.
- Recommended: the **Open API** (controller 5.9 or later) — an application created in the controller
  (Global View → Settings → Platform Integration → Open API, client mode). Without it, a dedicated
  **local administrator account** works too, read-only.

## Installation

In Gladys: **Integrations → Install from GitHub**, enter `guim31/gladys-omada`, then fill in the
Configuration screen (controller address, connection mode and credentials, site) and click **Test the
connection**. Add the Omada devices and the clients to follow from the **Discovery** tab.

The full documentation, in four languages, is in [`docs/`](docs/en.md) and in the Gladys interface.

## How it works

- The container reads the site on its own timer (30 s to 5 min, 1 min by default): the device list,
  the connected clients, the WAN status of the gateway and the PoE usage — 4 to 6 requests per read,
  one at a time and spaced (the controllers accept about 10 requests per second). Gladys' own polling
  is only a fallback ([Gladys#3198](https://github.com/GladysAssistant/Gladys/issues/3198)).
- Only the changed states are published, plus a heartbeat every 6 hours.
- The Open API access token lives in memory only. `/data` holds one file: the MAC addresses already
  seen on the site, for the _New unknown client_ trigger.

## Limits

- Developed without the hardware (see above).
- The local account mode only reads: the commands need the Open API.
- Some switches (Agile series) refuse the PoE command of the Open API; the controller's error is shown.
- The client throughput of a switch or an access point is the sum of its clients' activity, not a port
  counter.
- Phones with a private MAC address per network count as a new client on each network.
- A cloud-based controller may work through its Open API address and Omada ID; not tested.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs https://<controller>:8043 --insecure   # read-only check of a real controller
```

`scripts/probe.mjs` reads `/api/info` and checks that the controller refuses an invented Open API
application and an invented account: it never sends a real credential and changes nothing.

## Credits

- [tplink-omada-client](https://github.com/MarkGodwin/tplink-omada-api) by Mark Godwin (MIT) — the web
  API paths, login and session handling.
- The Home Assistant [`tplink_omada`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/tplink_omada)
  integration (Apache-2.0) — its test fixtures, anonymized, are the web API answers of the tests.
- [ha-omada-open-api](https://github.com/bullitt186/ha-omada-open-api) by bullitt186 (MIT) — the Open
  API paths for PoE, restart, SSID overrides and WAN status.
- [omini-plugin-omada](https://github.com/riccardoalv/omini-plugin-omada) (MIT) — the Open API client
  credentials flow and its test fixtures, anonymized, used as the Open API answers of the tests.
- Built from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js) and
  [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys Assistant.

## License

[Apache-2.0](LICENSE).
