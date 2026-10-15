// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish says "usted" (maintainer's choice).
// Brands (Omada, TP-Link, PoE, Wi-Fi, SSID, WAN) are not translated.
//
// The feature names are frozen by Gladys when the user adds the device: they
// follow the `language` of the configuration at that moment.
// Placeholders are written {name} and filled by format().
// -----------------------------------------------------------------------------

/** Feature names, by language. */
export const NAMES = {
  en: {
    online: 'Online',
    clients: 'Connected clients',
    uptime: 'Uptime',
    cpu: 'CPU usage',
    memory: 'Memory usage',
    download: 'Client download',
    upload: 'Client upload',
    poe: 'PoE power',
    presence: 'Presence',
    wanOnline: 'Internet {port}',
    wanDownload: 'Download {port}',
    wanUpload: 'Upload {port}',
  },
  fr: {
    online: 'En ligne',
    clients: 'Clients connectés',
    uptime: 'Temps de fonctionnement',
    cpu: 'Utilisation du processeur',
    memory: 'Utilisation de la mémoire',
    download: 'Débit descendant des clients',
    upload: 'Débit montant des clients',
    poe: 'Puissance PoE',
    presence: 'Présence',
    wanOnline: 'Internet {port}',
    wanDownload: 'Débit descendant {port}',
    wanUpload: 'Débit montant {port}',
  },
  de: {
    online: 'Online',
    clients: 'Verbundene Clients',
    uptime: 'Betriebszeit',
    cpu: 'CPU-Auslastung',
    memory: 'Speicherauslastung',
    download: 'Client-Download',
    upload: 'Client-Upload',
    poe: 'PoE-Leistung',
    presence: 'Anwesenheit',
    wanOnline: 'Internet {port}',
    wanDownload: 'Download {port}',
    wanUpload: 'Upload {port}',
  },
  es: {
    online: 'En línea',
    clients: 'Clientes conectados',
    uptime: 'Tiempo de actividad',
    cpu: 'Uso de CPU',
    memory: 'Uso de memoria',
    download: 'Descarga de los clientes',
    upload: 'Subida de los clientes',
    poe: 'Potencia PoE',
    presence: 'Presencia',
    wanOnline: 'Internet {port}',
    wanDownload: 'Descarga {port}',
    wanUpload: 'Subida {port}',
  },
};

/** Messages: connection status, action results, errors. */
export const TEXT = {
  notConfigured: {
    en: 'Fill in the controller address and the credentials of the chosen mode.',
    fr: "Renseignez l'adresse du contrôleur et les identifiants du mode choisi.",
    de: 'Gib die Adresse des Controllers und die Zugangsdaten der gewählten Art ein.',
    es: 'Introduzca la dirección del controlador y las credenciales del modo elegido.',
  },
  unreachable: {
    en: 'Omada controller unreachable: {reason}',
    fr: 'Contrôleur Omada injoignable : {reason}',
    de: 'Omada-Controller nicht erreichbar: {reason}',
    es: 'Controlador Omada inaccesible: {reason}',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, schau in die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  testOk: {
    en: 'Connected to site {site} (controller {version}): {devices} Omada devices, {clients} clients online.',
    fr: 'Connecté au site {site} (contrôleur {version}) : {devices} équipements Omada, {clients} clients en ligne.',
    de: 'Mit Site {site} verbunden (Controller {version}): {devices} Omada-Geräte, {clients} Clients online.',
    es: 'Conectado al sitio {site} (controlador {version}): {devices} equipos Omada, {clients} clientes en línea.',
  },
  readOnlyMode: {
    en: 'Commands need the Open API mode: the local account mode only reads.',
    fr: 'Les commandes demandent le mode Open API : le mode compte local ne fait que lire.',
    de: 'Befehle brauchen den Open-API-Modus: Der Modus mit lokalem Konto liest nur.',
    es: 'Los comandos necesitan el modo Open API: el modo de cuenta local solo lee.',
  },
  poeDisabled: {
    en: 'PoE control is off: turn on "Allow PoE control" in the configuration.',
    fr: 'Le pilotage du PoE est désactivé : activez « Autoriser le pilotage du PoE » dans la configuration.',
    de: 'Die PoE-Steuerung ist aus: Aktiviere „PoE-Steuerung erlauben“ in der Konfiguration.',
    es: 'El control del PoE está desactivado: active «Permitir el control del PoE» en la configuración.',
  },
  rebootDisabled: {
    en: 'Restarting devices is off: turn on "Allow restarts" in the configuration.',
    fr: 'Le redémarrage est désactivé : activez « Autoriser les redémarrages » dans la configuration.',
    de: 'Neustarts sind aus: Aktiviere „Neustarts erlauben“ in der Konfiguration.',
    es: 'Los reinicios están desactivados: active «Permitir los reinicios» en la configuración.',
  },
  ssidDisabled: {
    en: 'SSID control is off: turn on "Allow SSID control" in the configuration.',
    fr: 'Le pilotage des SSID est désactivé : activez « Autoriser le pilotage des SSID » dans la configuration.',
    de: 'Die SSID-Steuerung ist aus: Aktiviere „SSID-Steuerung erlauben“ in der Konfiguration.',
    es: 'El control de los SSID está desactivado: active «Permitir el control de los SSID» en la configuración.',
  },
  notReady: {
    en: 'The controller has not been read yet: try again in a minute.',
    fr: "Le contrôleur n'a pas encore été lu : réessayez dans une minute.",
    de: 'Der Controller wurde noch nicht gelesen: Versuch es in einer Minute noch mal.',
    es: 'El controlador aún no se ha leído: inténtelo de nuevo dentro de un minuto.',
  },
  unknownDevice: {
    en: 'This device is not on the Omada site any more.',
    fr: "Cet appareil n'est plus sur le site Omada.",
    de: 'Dieses Gerät ist nicht mehr auf der Omada-Site.',
    es: 'Este dispositivo ya no está en el sitio Omada.',
  },
  notEquipment: {
    en: 'Choose a gateway, a switch or an access point, not a network client.',
    fr: 'Choisissez une passerelle, un switch ou une borne, pas un client du réseau.',
    de: 'Wähle ein Gateway, einen Switch oder einen Access Point, keinen Netzwerk-Client.',
    es: 'Elija una puerta de enlace, un switch o un punto de acceso, no un cliente de la red.',
  },
  notSwitch: {
    en: '{device} is not a switch: PoE is switched on the switch ports.',
    fr: "{device} n'est pas un switch : le PoE se pilote sur les ports d'un switch.",
    de: '{device} ist kein Switch: PoE wird an den Ports eines Switches gesteuert.',
    es: '{device} no es un switch: el PoE se controla en los puertos de un switch.',
  },
  offline: {
    en: '{device} is offline: the controller cannot reach it.',
    fr: "{device} est hors ligne : le contrôleur ne peut pas l'atteindre.",
    de: '{device} ist offline: Der Controller erreicht es nicht.',
    es: '{device} está fuera de línea: el controlador no puede alcanzarlo.',
  },
  invalidPort: {
    en: 'The port is a whole number from 1 to 128.',
    fr: 'Le port est un nombre entier de 1 à 128.',
    de: 'Der Port ist eine ganze Zahl von 1 bis 128.',
    es: 'El puerto es un número entero de 1 a 128.',
  },
  invalidState: {
    en: 'Choose "On" or "Off".',
    fr: 'Choisissez « Activé » ou « Désactivé ».',
    de: 'Wähle „Ein“ oder „Aus“.',
    es: 'Elija «Activado» o «Desactivado».',
  },
  poeOn: {
    en: 'PoE turned on, port {port} of {device}.',
    fr: 'PoE activé, port {port} de {device}.',
    de: 'PoE eingeschaltet, Port {port} von {device}.',
    es: 'PoE activado, puerto {port} de {device}.',
  },
  poeOff: {
    en: 'PoE turned off, port {port} of {device}.',
    fr: 'PoE coupé, port {port} de {device}.',
    de: 'PoE ausgeschaltet, Port {port} von {device}.',
    es: 'PoE desactivado, puerto {port} de {device}.',
  },
  rebootDone: {
    en: '{device} is restarting: it is offline for a few minutes.',
    fr: '{device} redémarre : il sera hors ligne quelques minutes.',
    de: '{device} startet neu: Es ist ein paar Minuten offline.',
    es: '{device} se está reiniciando: estará fuera de línea unos minutos.',
  },
  ssidOn: {
    en: 'SSID {ssid} enabled on {count} access point(s).',
    fr: 'SSID {ssid} activé sur {count} borne(s).',
    de: 'SSID {ssid} auf {count} Access Point(s) aktiviert.',
    es: 'SSID {ssid} activado en {count} punto(s) de acceso.',
  },
  ssidOff: {
    en: 'SSID {ssid} disabled on {count} access point(s).',
    fr: 'SSID {ssid} désactivé sur {count} borne(s).',
    de: 'SSID {ssid} auf {count} Access Point(s) deaktiviert.',
    es: 'SSID {ssid} desactivado en {count} punto(s) de acceso.',
  },
  ssidUnknown: {
    en: 'No access point broadcasts "{ssid}". SSIDs: {list}.',
    fr: 'Aucune borne ne diffuse « {ssid} ». SSID : {list}.',
    de: 'Kein Access Point sendet „{ssid}“. SSIDs: {list}.',
    es: 'Ningún punto de acceso emite «{ssid}». SSID: {list}.',
  },
  commandFailed: {
    en: 'The controller refused the command: {reason}',
    fr: 'Le contrôleur a refusé la commande : {reason}',
    de: 'Der Controller hat den Befehl abgelehnt: {reason}',
    es: 'El controlador ha rechazado el comando: {reason}',
  },
};

/** Why the controller could not be read, by kind of failure (src/omada/errors.js). */
export const REASONS = {
  auth: {
    en: 'credentials refused, check them in the configuration.',
    fr: 'identifiants refusés, vérifiez-les dans la configuration.',
    de: 'Zugangsdaten abgelehnt, prüfe sie in der Konfiguration.',
    es: 'credenciales rechazadas, compruébelas en la configuración.',
  },
  forbidden: {
    en: 'access refused: give the application or the account access to this site.',
    fr: "accès refusé : donnez à l'application ou au compte l'accès à ce site.",
    de: 'Zugriff verweigert: Gib der Anwendung oder dem Konto Zugriff auf diese Site.',
    es: 'acceso denegado: dé a la aplicación o a la cuenta acceso a este sitio.',
  },
  site: {
    en: 'site not found. Sites: {detail}.',
    fr: 'site introuvable. Sites : {detail}.',
    de: 'Site nicht gefunden. Sites: {detail}.',
    es: 'sitio no encontrado. Sitios: {detail}.',
  },
  not_omada: {
    en: 'this address does not answer like an Omada controller (5.9 or later for the Open API).',
    fr: "cette adresse ne répond pas comme un contrôleur Omada (5.9 ou plus pour l'Open API).",
    de: 'diese Adresse antwortet nicht wie ein Omada-Controller (5.9 oder neuer für die Open API).',
    es: 'esta dirección no responde como un controlador Omada (5.9 o posterior para la Open API).',
  },
  unsupported: {
    en: 'this controller or device does not support the request.',
    fr: 'ce contrôleur ou cet équipement ne prend pas en charge la demande.',
    de: 'dieser Controller oder dieses Gerät unterstützt die Anfrage nicht.',
    es: 'este controlador o equipo no admite la solicitud.',
  },
  certificate: {
    en: 'certificate refused: turn on "Accept a self-signed certificate".',
    fr: 'certificat refusé : activez « Accepter un certificat auto-signé ».',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“.',
    es: 'certificado rechazado: active «Aceptar un certificado autofirmado».',
  },
  network: {
    en: 'no answer, check the address and the port.',
    fr: "pas de réponse, vérifiez l'adresse et le port.",
    de: 'keine Antwort, prüfe Adresse und Port.',
    es: 'sin respuesta, compruebe la dirección y el puerto.',
  },
  refused: {
    en: 'unexpected answer ({detail}).',
    fr: 'réponse inattendue ({detail}).',
    de: 'unerwartete Antwort ({detail}).',
    es: 'respuesta inesperada ({detail}).',
  },
};

/** Short texts of the dashboard widget. */
export const WIDGET_TEXT = {
  clients: { en: 'Clients', fr: 'Clients', de: 'Clients', es: 'Clientes' },
  wifi: { en: 'Wi-Fi', fr: 'Wi-Fi', de: 'WLAN', es: 'Wi-Fi' },
  wired: { en: 'Wired', fr: 'Filaires', de: 'Kabel', es: 'Por cable' },
  download: { en: 'Download', fr: 'Descendant', de: 'Download', es: 'Descarga' },
  upload: { en: 'Upload', fr: 'Montant', de: 'Upload', es: 'Subida' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Fuera de línea' },
  noLink: { en: 'No link', fr: 'Pas de lien', de: 'Kein Link', es: 'Sin enlace' },
  noInternet: { en: 'No Internet', fr: "Pas d'Internet", de: 'Kein Internet', es: 'Sin Internet' },
  devices: {
    en: 'Omada devices online',
    fr: 'Équipements Omada en ligne',
    de: 'Omada-Geräte online',
    es: 'Equipos Omada en línea',
  },
  notConfigured: {
    en: 'Configure the integration first.',
    fr: "Configurez d'abord l'intégration.",
    de: 'Konfiguriere zuerst die Integration.',
    es: 'Configure primero la integración.',
  },
  waiting: {
    en: 'Waiting for the first reading of the controller.',
    fr: 'En attente de la première lecture du contrôleur.',
    de: 'Warte auf das erste Auslesen des Controllers.',
    es: 'Esperando la primera lectura del controlador.',
  },
};

/**
 * Fill the {placeholders} of a text.
 * @param {string} template
 * @param {Record<string, string|number>} [vars]
 */
export function format(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined ? match : String(vars[key]),
  );
}

/**
 * One text of a table in one language (English when the language is unknown).
 * @param {Record<string, string>} entry
 * @param {string} language
 * @param {Record<string, string|number>} [vars]
 */
export function pick(entry, language, vars) {
  return format(entry[language] ?? entry.en, vars);
}

/**
 * A multi-language object from a table entry, placeholders filled.
 * @param {Record<string, string>} entry
 * @param {Record<string, string|number> | ((lang: string) => Record<string, string|number>)} [vars]
 */
export function localized(entry, vars = {}) {
  return Object.fromEntries(
    Object.entries(entry).map(([lang, template]) => [
      lang,
      format(template, typeof vars === 'function' ? vars(lang) : vars),
    ]),
  );
}

/**
 * The reason of a failure, as a multi-language object.
 * @param {Error & { kind?: string, certificate?: boolean, detail?: string }} err
 */
export function reasonOf(err) {
  const kind = err?.certificate
    ? 'certificate'
    : err?.name === 'OmadaTransportError'
      ? 'network'
      : (err?.kind ?? 'refused');
  const entry = REASONS[kind] ?? REASONS.refused;
  return localized(entry, { detail: err?.detail ?? err?.message ?? '-' });
}

/**
 * A message with a {reason} placeholder, as a multi-language object.
 * @param {Record<string, string>} entry
 * @param {Error} err
 */
export function withReason(entry, err) {
  const reason = reasonOf(err);
  return localized(entry, (lang) => ({ reason: reason[lang] }));
}
