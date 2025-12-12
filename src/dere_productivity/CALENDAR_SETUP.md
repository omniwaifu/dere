# Google Calendar Setup for dere-productivity

This guide walks you through setting up Google Calendar integration for the dere-productivity plugin.

## Overview

The dere-productivity plugin uses the `@cocal/google-calendar-mcp` package to connect to your Google Calendar. This requires OAuth authentication with Google.

## Prerequisites

- Node.js and npm installed
- A Google account with Google Calendar
- Access to Google Cloud Console

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
   - Click "Select a project" dropdown
   - Click "New Project"
   - Name it (e.g., "dere-productivity")
   - Click "Create"

### 2. Enable Google Calendar API

1. In the Cloud Console, go to "APIs & Services" > "Library"
2. Search for "Google Calendar API"
3. Click on it and click "Enable"

### 3. Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Choose "External" (unless you have a Google Workspace)
3. Fill in the required fields:
   - App name: "dere Productivity"
   - User support email: your email
   - Developer contact: your email
4. Click "Save and Continue"
5. Scopes: Click "Add or Remove Scopes"
   - Add: `https://www.googleapis.com/auth/calendar`
   - Add: `https://www.googleapis.com/auth/calendar.events`
6. Click "Save and Continue"
7. Test users: Add your email address
8. Click "Save and Continue"

### 4. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Application type: "Desktop app"
4. Name: "dere MCP Calendar"
5. Click "Create"
6. Download the JSON file
   - Save it as `google-calendar-credentials.json`
   - Store it securely (e.g., `~/.config/dere/google-calendar-credentials.json`)

**Important**: Keep this file secret! Add it to `.gitignore` if in a repository.

### 5. Install and Configure MCP Server

The MCP server is automatically loaded by the plugin when productivity mode is enabled.

#### Configuration

The plugin.json already includes the calendar MCP:

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["-y", "@cocal/google-calendar-mcp"]
    }
  }
}
```

However, you may need to pass credentials. Check the `@cocal/google-calendar-mcp` documentation for specifics:

```bash
# The MCP server may look for credentials in these locations:
# 1. Environment variable: GOOGLE_CALENDAR_CREDENTIALS
# 2. ~/.config/google-calendar-mcp/credentials.json
# 3. Passed via args
```

If needed, update the args to include credentials path:

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": [
        "-y",
        "@cocal/google-calendar-mcp",
        "--credentials",
        "~/.config/dere/google-calendar-credentials.json"
      ]
    }
  }
}
```

### 6. First-Time OAuth Flow

When you first use a calendar feature:

1. dere will launch a browser window
2. Sign in to your Google account
3. Grant permissions to access your calendar
4. Browser will show "Authentication successful"
5. Token will be saved locally for future use

**Tokens are stored locally** - usually in:
- `~/.config/google-calendar-mcp/tokens/`
- Or wherever the MCP server configures

### 7. Test the Integration

Enable productivity mode and test calendar access:

```bash
# Start dere with productivity mode
dere --mode productivity

# Or if configured in config.toml to always enable:
dere
```

Then try a calendar command:
```
/plan-day
```

Or ask:
```
What's on my calendar today?
```

If working, you should see your calendar events.

## Troubleshooting

### "Failed to authenticate"

- Check credentials JSON file path
- Verify OAuth consent screen is configured
- Check that Calendar API is enabled
- Try deleting saved tokens and re-authenticating

### "Access denied"

- Make sure you added your email as a test user
- Verify the scopes include calendar access
- Check that the OAuth consent screen is not expired

### "MCP server not found"

- Ensure Node.js and npm are installed
- The first run of `npx -y @cocal/google-calendar-mcp` may take time to download
- Check network connection

### "No events returned"

- Verify you have events in your calendar
- Check timezone settings
- Try a specific time range query

## Privacy & Security

- **Credentials stay local**: OAuth tokens are stored on your machine only
- **Minimum scopes**: Only calendar read/write access requested
- **No data sharing**: dere doesn't send calendar data anywhere
- **Revoke anytime**: Go to [Google Account Permissions](https://myaccount.google.com/permissions) to revoke

## Configuration Options

Add to `~/.config/dere/config.toml`:

```toml
[context]
calendar = true  # Enable calendar in productivity context

[plugins.dere_productivity]
mode = "always"  # Always enable productivity features
```

## Alternative: CalDAV

If you prefer not to use Google's OAuth, you can:

1. Use a CalDAV-compatible calendar (Nextcloud, Apple Calendar, etc.)
2. Find or create a CalDAV MCP server
3. Update `plugin.json` to use that server instead

The calendar skills are designed to work with any calendar MCP that follows standard patterns.

## Further Reading

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/guides/overview)
- [OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [@cocal/google-calendar-mcp GitHub](https://github.com/cocal-project/google-calendar-mcp) (check for latest docs)

## Support

If you encounter issues:

1. Check the MCP server logs
2. Test the MCP server directly: `npx @cocal/google-calendar-mcp --help`
3. Verify credentials and tokens
4. File an issue on the dere repository with details

---

Once set up, you'll have full calendar integration for intelligent scheduling and planning!
