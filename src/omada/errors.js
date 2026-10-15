// -----------------------------------------------------------------------------
// Errors of the controller APIs, sorted by what the user can do about them.
//
// Every message is in English and free of secrets and addresses: it may reach
// the logs and, translated by kind, the Configuration screen.
// -----------------------------------------------------------------------------

/** Kinds of failure, each with its own user-facing explanation (src/i18n.js). */
export const ERROR_KINDS = {
  /** Wrong client ID / secret, or wrong username / password. */
  AUTH: 'auth',
  /** The Open API application or the account may not do this (viewer role, site not granted). */
  FORBIDDEN: 'forbidden',
  /** The site named in the configuration does not exist for these credentials. */
  SITE: 'site',
  /** The address does not answer like an Omada controller (version too old, wrong port). */
  NOT_OMADA: 'not_omada',
  /** The endpoint is missing on this controller version or model. */
  UNSUPPORTED: 'unsupported',
  /** Any other refusal of the controller. */
  REFUSED: 'refused',
};

export class OmadaApiError extends Error {
  /**
   * @param {string} message
   * @param {{ kind?: string, errorCode?: number|null, status?: number|null }} [details]
   */
  constructor(message, { kind = ERROR_KINDS.REFUSED, errorCode = null, status = null } = {}) {
    super(message);
    this.name = 'OmadaApiError';
    this.kind = kind;
    this.errorCode = errorCode;
    this.status = status;
  }
}

/** Open API error codes (access guide, section 1.2). */
export const OPENAPI_CODES = {
  INVALID_CLIENT: -44106,
  TOKEN_EXPIRED: -44112,
  TOKEN_INVALID: -44113,
  UNSUPPORTED: -1600,
  FORBIDDEN: [-1005, -1007, -1505],
};

/** Web API: the code of a refused login (tplink-omada-client). */
export const WEB_LOGIN_FAILED = -30109;

/**
 * Compare two dotted versions ("5.15.20.20" >= "5.9").
 * @param {string} version
 * @param {string} minimum
 */
export function versionAtLeast(version, minimum) {
  const a = String(version ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const b = String(minimum)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x > y;
    }
  }
  return true;
}
