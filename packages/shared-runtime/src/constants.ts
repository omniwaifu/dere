export const DEFAULT_DAEMON_URL = "http://localhost:8787";
export const DEFAULT_DAEMON_PORT = 8787;

export function getDaemonSocketPath(): string {
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    return `${xdgRuntime}/dere/daemon.sock`;
  }
  return "/run/dere/daemon.sock";
}

export const DEFAULT_ACTIVITYWATCH_URL = "http://localhost:5600";
export const DEFAULT_ACTIVITYWATCH_PORT = 5600;

export const DEFAULT_DB_URL = "postgresql://postgres:dere@localhost/dere";
export const DEFAULT_DB_ASYNC_URL = "postgresql+asyncpg://postgres:dere@localhost/dere";

export const DEFAULT_FALKOR_HOST = "localhost";
export const DEFAULT_FALKOR_PORT = 6379;
export const DEFAULT_FALKOR_DATABASE = "dere_graph";

export const DEFAULT_DISCORD_IDLE_TIMEOUT = 1200;

export const DEFAULT_AMBIENT_IDLE_THRESHOLD_MINUTES = 60;
export const DEFAULT_AMBIENT_CHECK_INTERVAL_MINUTES = 30;

export const DEFAULT_ACTIVITY_LOOKBACK_MINUTES = 10;
export const DEFAULT_RECENT_FILES_TIMEFRAME = "1h";
