/** Initial reconnect delay in ms. Doubles on each failure. */
export const INITIAL_RECONNECT_DELAY = 1000;

/** Maximum reconnect delay in ms. */
export const MAX_RECONNECT_DELAY = 30_000;

/** HTTP proxy timeout for port forwarding in ms. */
export const HTTP_PROXY_TIMEOUT = 25_000;

/** Debounce delay for snapshot after terminal clear in ms. */
export const SNAPSHOT_DEBOUNCE = 500;

/** Debounce delay for terminal resize DB updates in ms. */
export const RESIZE_DB_DEBOUNCE = 500;

/** Timeout waiting for WebSocket close frame on shutdown in ms. */
export const WS_CLOSE_TIMEOUT = 500;

/** Maximum command length accepted for spawn. */
export const MAX_COMMAND_LENGTH = 4096;
