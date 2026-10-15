# TP-Link Omada

Brings your **TP-Link Omada** network into Gladys: who is home (phones on the Wi-Fi), the state of your
access points, switches and gateway, your Internet connection, and a few commands for your scenes.

Not affiliated with TP-Link. **Developed without the hardware: feedback welcome** — the integration is
tested against a fake controller built from published answers of real controllers, not against a real
one yet.

## Overview

- **Presence**: every phone, laptop or device connected to the network can become a presence sensor,
  with a departure delay so a phone in sleep mode does not "leave" every few minutes.
- **Omada devices**: one Gladys device per gateway, switch and access point: online, connected clients,
  uptime, CPU and memory usage, client throughput, PoE power drawn by a PoE switch, and for the gateway
  the Internet state and throughput of each WAN port.
- **Scene triggers**: a new unknown device joins the network, an Omada device goes offline, a WAN port
  loses or gets back Internet.
- **Commands** (off by default): turn the PoE of a switch port on or off, restart an Omada device, turn
  an SSID (the guest Wi-Fi) on or off.
- **Dashboard widget**: clients, Internet throughput, WAN ports and Omada devices offline at a glance.

## Prerequisites

- An Omada controller: **Software Controller**, **OC200** or **OC300**, reachable from Gladys on the
  local network. A cloud-based controller may work through its Open API address (not tested).
- **Recommended: the Open API** (controller 5.9 or later). In the controller, open **Global View →
  Settings → Platform Integration → Open API**, add an application in **Client** mode, give it the site
  to follow, and note its **client ID** and **client secret**. A _viewer_ role is enough to read; the
  commands need a role allowed to change the site (administrator).
- **Or a local administrator account** (any controller version 5.x): create a dedicated local account
  in the controller. In this mode the integration **only reads**: no command.

## Configuration

In Gladys, **Integrations → TP-Link Omada → Configuration**:

| Field                                       | What to enter                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Controller address                          | `https://<address>:8043` for the Software Controller, `https://<address>` for an OC200 / OC300.           |
| Connection mode                             | Open API (recommended) or local administrator account (read-only).                                        |
| Open API client ID / secret                 | The application created above (Open API mode).                                                            |
| Local account username/password             | The dedicated account (local account mode).                                                               |
| Site                                        | The name of the Omada site (`Default` by default).                                                        |
| Accept a self-signed certificate            | The controller ships a self-signed certificate: turn this on unless you installed a trusted one.          |
| Omada ID                                    | Leave empty for a local controller. Cloud-based controller only: the Omada ID shown on its Open API page. |
| Offer the network clients                   | Shows the clients online in the Discovery tab, to add the ones to follow.                                 |
| Departure delay                             | Minutes a client must be gone before it is reported away (5 by default).                                  |
| Refresh interval                            | 30 s, 1 min (default), 2 min or 5 min.                                                                    |
| Allow PoE control / restarts / SSID control | Each command is off by default: turn on only what your scenes need.                                       |
| Language of the feature names               | French by default; the names are set when a device is added.                                              |

Then click **Test the connection**: the message gives the site, the controller version and what it
found. Open the **Discovery** tab to add the Omada devices and the clients to follow.

**What the integration asks of the controller.** One read of the site per refresh interval: the device
list, the connected clients, the WAN status of the gateway and the PoE usage (4 to 6 requests). The
Omada controllers accept about 10 requests per second; the integration spaces its requests and never
sends more than one at a time. Opening a dashboard costs the controller nothing: the widget shows the
latest read. The Open API access token lives in memory only and is renewed with the client credentials
when it expires (two hours).

## Devices

**Gateway, switch, access point** (one Gladys device each, named like in the controller):

| Feature                                  | Unit          | Devices                       |
| ---------------------------------------- | ------------- | ----------------------------- |
| Online                                   | 0 / 1         | all                           |
| Connected clients                        | count         | all (clients connected to it) |
| Uptime                                   | hours         | all                           |
| CPU usage, memory usage                  | %             | all                           |
| Client download / upload                 | Mbit/s        | switch, access point          |
| PoE power                                | W             | PoE switch                    |
| Internet, download, upload, per WAN port | 0 / 1, Mbit/s | gateway                       |

The client throughput of a switch or an access point is the sum of the real-time activity of the
clients connected to it, as the controller reports it — not the traffic of its uplink.

**Network client** (a phone, a laptop…): one **Presence** feature (`presence-sensor`, yes/no). It is 1
while the client is connected, and drops to 0 once it has been missing for longer than the departure
delay. A controller that does not answer never makes anybody leave: presence is only evaluated on a
successful read. Clients you added stay in the Discovery tab even while away.

Everything is read-only: the commands are actions (see below), on purpose never switches a voice
assistant or a misclick could flip.

## Widget

**Omada network**: tiles for the clients (total, Wi-Fi, wired) and the Internet download and upload,
then the state of each WAN port (with its public IP address), the number of Omada devices online and
the name of those offline. It shows the latest read and refreshes with it.

## Scene triggers

| Trigger                    | Filters                                         | Variables                                                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| New unknown network client | connection (Wi-Fi / wired), SSID, guest network | name, MAC address, IP address, SSID, connection, connected to |
| Omada device offline       | device, type (gateway, switch, access point)    | device name, model, type                                      |
| WAN down or back           | change (Internet lost / back), gateway          | change, WAN port, gateway, WAN IP address                     |

- **New unknown client** fires for a MAC address never seen on the site. The first read after the
  installation only learns the clients already there; the known MAC addresses are kept in `/data` (MAC
  addresses only, nothing else).
- **Device offline** covers every Omada device of the site, even those not added to Gladys, and gives
  their name for the notification.
- Only transitions fire: a restart of Gladys, of the integration or of the controller never does.

## Commands

Open API mode only, each one turned on in the configuration. Available as buttons of the Configuration
screen and as scene actions:

- **PoE of a switch port**: choose the switch, the port number and on / off. The port gets a profile
  override in the controller, as the PoE of a port that follows its profile cannot change.
  **Warning: cutting the PoE switches off what the port powers** — a security camera, an access point,
  a phone. Keep it for what you really want to switch off (an access point at night, a device to
  restart), never for a camera that protects the house.
- **Restart an Omada device**: the device is offline for a few minutes.
- **Turn an SSID on or off**: type the network name (e.g. `Guest`); it is enabled or disabled on every
  access point that broadcasts it.

Each command writes one line in the logs of the integration.

## Scene examples

- **Nobody home**: when the presence of every phone is 0, set the house to away, turn off the lights,
  arm the alarm.
- **Guest Wi-Fi on a schedule**: every day at 8:00, scene action _Turn an SSID on or off_ → `Guest`, on;
  at 23:00, off.
- **Internet down**: trigger _WAN down or back_, change _Internet lost_ → send a message
  "{{triggerEvent.data.port_name}} lost Internet".
- **Intruder on the Wi-Fi**: trigger _New unknown network client_, SSID `Home` → send a message with
  {{triggerEvent.data.name}} and {{triggerEvent.data.ip}}.
- **Access point off at night**: at 0:30, _PoE of a switch port_ off for the port of the garden access
  point; at 7:00, on.

## Troubleshooting

- **"certificate refused"**: turn on _Accept a self-signed certificate_.
- **"credentials refused"**: check the client ID and secret (Open API) or the username and password
  (local account). An Open API application deleted or edited in the controller gets a new secret.
- **"site not found"**: the message lists the sites the credentials can see; copy the name.
- **"access refused"**: give the Open API application (or the account) access to the site; for the
  commands, a role allowed to change the site.
- **"does not answer like an Omada controller"**: check the port (8043 for the Software Controller) and
  that the Open API exists (controller 5.9 or later).
- **A command answers an error on a switch**: some switches (Agile series) refuse the PoE command of the
  Open API; the controller's message is shown.
- More details: set the `LOG_LEVEL` environment variable to `debug`. The logs never contain a secret.

## Limits

- Developed without the hardware: the request shapes come from the Open API access guide and from
  clients that run against real controllers; real-world feedback is welcome.
- The local account mode only reads: the commands need the Open API.
- Presence follows the Wi-Fi: a phone that leaves the Wi-Fi in deep sleep for longer than the delay is
  reported away. Raise the delay if needed.
- Phones with a private (random) MAC address per network are a new client on each network they join.
- The client throughput of a switch or an access point is the sum of its clients' activity, not a port
  counter. The WAN rates are those the controller reports.
- Feature names are frozen by Gladys when a device is added: change the language before adding them.
- A gateway WAN port that appears later (a new WAN) shows an "Update" button in the Discovery tab.
