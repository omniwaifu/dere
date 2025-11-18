---
description: Search tool usage log for patterns
allowed-tools: Bash
argument-hint: <keyword>
---

Search the tool usage log for patterns matching the keyword provided.

This command helps you discover effective tool usage patterns that have been automatically logged during previous sessions.

Execute these steps:

1. Check if tool usage log exists:
   ```bash
   if [ -f .agent-notes/tool-usage-log.md ]; then
     echo "Found tool usage log"
   else
     echo "No tool usage log found. Tool usage will be logged automatically as you work."
     exit 0
   fi
   ```

2. Search for the keyword in the tool usage log:
   ```bash
   KEYWORD="$ARGUMENTS"

   if [ -z "$KEYWORD" ]; then
     echo "Usage: /playbook-search <keyword>"
     echo "Example: /playbook-search WebFetch"
     echo "Example: /playbook-search authentication"
     exit 1
   fi

   echo "Searching for: $KEYWORD"
   echo "================================"

   grep -i -A 5 -B 2 "$KEYWORD" .agent-notes/tool-usage-log.md || echo "No matches found for: $KEYWORD"
   ```

3. Suggest related searches:
   ```bash
   echo ""
   echo "Related searches you might try:"
   echo "  /playbook-search Bash"
   echo "  /playbook-search WebFetch"
   echo "  /playbook-search Edit"
   echo "  /playbook-search [your-keyword]"
   ```

## Purpose

The tool usage log is automatically populated by the `tool-logger.sh` hook, which captures:
- Tool names used
- When they were used (timestamps)
- Brief result previews

This creates a "playbook" of effective patterns over time, helping you:
- Remember successful tool sequences
- Discover which tools solved which problems
- Build institutional knowledge of effective workflows

## Inspired by

Eigent's tool lifecycle tracking pattern (@listen_toolkit) that monitors:
- Which agent used which tool
- For which task
- With what result

This helps build effective playbooks and identify optimization opportunities.
