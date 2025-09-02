# dere

[English](README.md) | 中文 | [日本語](README.ja.md)

**为什么要这样做：** 我在所有事情上都使用 Claude Code，我喜欢在打开终端时让它保持"角色扮演"，例如 `dere --tsun --mcp=spotify`

为 Claude CLI 提供可组合人格层的分层 AI 助手。

**构建：** `make`

**用法：**
- `dere --tsun` - 傲娇模式  
- `dere --kuu` - 冷静分析
- `dere --yan` - 过度热心  
- `dere --dere` - 真正友善
- `dere --ero` - 调皮戏弄
- `dere --bare` - 纯净 Claude
- `dere --context` - 添加时间/日期上下文
- `dere --custom-prompt` - 来自 `~/.config/dere/prompts/custom-prompt.md` 的自定义提示
- `dere --mcp=server1,server2` - 来自 `~/.claude/claude_desktop_config.json` 的 MCP 服务器

**自定义提示：** `~/.config/dere/prompts/*.md` **MCP：** 从 Claude Desktop 配置解析