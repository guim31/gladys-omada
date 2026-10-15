# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Connection to a TP-Link Omada controller (Software Controller, OC200,
  OC300) through the official Open API (client ID and secret, controller 5.9
  or later), or read-only through a local administrator account. A
  self-signed certificate is accepted on option.
- One Gladys device per gateway, switch and access point: online, connected
  clients, uptime, CPU and memory usage, client throughput, PoE power drawn by
  a PoE switch, and the Internet state and throughput of each WAN port.
- Presence: the network clients can be added from the Discovery tab as
  presence sensors, with an adjustable departure delay.
- Scene triggers: new unknown network client, Omada device offline, WAN down
  or back.
- Commands, off by default and available as actions and scene actions: PoE of
  a switch port, restart of an Omada device, SSID on or off.
- Dashboard widget "Omada network": clients, Internet throughput, WAN ports
  and Omada devices offline.
- A "Test the connection" action and a connection status that names the
  problem.
- Every text in English, French, German and Spanish, with the documentation in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-omada/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-omada/releases/tag/v1.0.1
