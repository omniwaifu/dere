/**
 * Type definitions for Claude Code settings and CLI.
 */

/**
 * Status line configuration for Claude Code.
 */
export interface StatusLineConfig {
  type?: "command";
  command?: string;
  padding?: number;
}

/**
 * Marketplace source configuration.
 */
export interface MarketplaceSource {
  source: {
    source: "directory";
    path: string;
  };
}

/**
 * Claude Code settings passed to the CLI via --settings-json.
 * All fields are optional since they're conditionally added.
 */
export interface ClaudeCodeSettings {
  /** Hook configurations */
  hooks: Record<string, unknown>;
  /** Status line display configuration */
  statusLine: StatusLineConfig;
  /** Environment variables passed to hooks and skills */
  env: Record<string, string>;
  /** Permission mode - set to "bypassPermissions" to skip all permissions */
  defaultMode?: "bypassPermissions";
  /** Output style identifier (e.g., "dere-vault:vault") */
  outputStyle?: string;
  /** Company announcements to display */
  companyAnnouncements?: string;
  /** Extra plugin marketplaces to load */
  extraKnownMarketplaces?: Record<string, MarketplaceSource>;
  /** Enabled plugins by identifier */
  enabledPlugins?: Record<string, boolean>;
}
