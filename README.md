# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

**But why:** I use Claude Code for everything and I like having it "in character" when I load up a terminal, e.g. `dere --tsun --mcp=spotify`

Layered AI assistant with composable personalities for Claude CLI.

**Build:** `make`

**Usage:**
- `dere --tsun` - Tsundere mode  
- `dere --kuu` - Cold analytical
- `dere --yan` - Overly helpful  
- `dere --dere` - Actually nice
- `dere --ero` - Playfully teasing
- `dere --bare` - Plain Claude
- `dere --context` - Add time/date context
- `dere --custom-prompt` - Custom prompts from `~/.config/dere/prompts/custom-prompt.md`
- `dere --mcp=server1,server2` - MCP servers from `~/.claude/claude_desktop_config.json`

**Custom prompts:** `~/.config/dere/prompts/*.md` **MCP:** Parsed from Claude Desktop config