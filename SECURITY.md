# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds, and where:

- **Secrets**: the Open API client secret or the local account password live
  in the Gladys configuration of the integration (`secret` fields, never sent
  back to the browser). They are never written to the logs, nor to `/data`.
  The Open API access token lives in memory only.
- **`/data`**: one file, `known-clients.json`, with the MAC addresses already
  seen on each Omada site (for the "new unknown client" trigger). No name, no
  IP address, no credential.
- **Network**: the container only talks to the controller address of the
  configuration (HTTPS; a self-signed certificate is accepted only when the
  user turns the option on) and to Gladys. No cloud service, no telemetry.
- **Commands**: the PoE, restart and SSID commands are off by default, need the
  Open API mode, and are never exposed as device switches. Use an Open API
  application with the smallest role that fits: a viewer role when the
  commands stay off.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Omada controller and devices the integration talks to.
