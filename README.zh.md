# dere

[English](README.md) | 中文 | [日本語](README.ja.md)

Claude CLI 的人格包装器，具有会话记忆、嵌入和心理健康跟踪功能。

**为什么：** 我在所有事情上都使用 Claude Code，希望打开终端时它能保持"角色扮演"。

## 安装

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

**要求：**
- [Claude CLI](https://github.com/anthropics/claude-cli)
- Python 3.13+
- [uv](https://github.com/astral-sh/uv)
- [Ollama](https://ollama.ai)（可选，用于嵌入）

## 使用

```bash
dere --personality tsun          # 傲娇（严厉但关心）
dere -P kuu                      # 冷娇（冷静分析）
dere --personality yan           # 病娇（过度热心）
dere -P dere                     # 甜娇（真心友善）
dere --bare                      # 纯 Claude

# 心理健康模式
dere --mode checkin              # 每日签到
dere --mode cbt                  # CBT 会话
dere --mode therapy              # 治疗会话

# 功能
dere --context                   # 添加时间/日期/天气上下文
dere -c                          # 继续之前的对话
dere --prompts=rust,security     # 加载自定义提示
dere --mcp=dev                   # 使用 MCP 配置文件
```

## Discord Bot（实验性）

```bash
uv run dere-discord --persona tsun
```

通过 `~/.config/dere/config.toml` 配置：

```toml
[discord]
token = "your-discord-bot-token"
default_persona = "tsun"
allowed_guilds = ""
allowed_channels = ""
idle_timeout_seconds = 1200
summary_grace_seconds = 30
context_enabled = true
```

## 配置

**配置：** `~/.config/dere/`（Linux）、`~/Library/Application Support/dere/`（macOS）
**数据：** `~/.local/share/dere/`（Linux）、`~/Library/Application Support/dere/`（macOS）

### 自定义人格

创建 `~/.config/dere/personalities/custom.toml`：

```toml
[metadata]
name = "custom"
aliases = ["custom"]

[display]
color = "cyan"
icon = "●"

[prompt]
content = """
在这里写人格描述...
"""
```

### 自定义提示

将 `.md` 文件添加到 `~/.config/dere/prompts/` 以添加领域特定知识。

### 守护进程

```bash
dere daemon start                # 启动后台处理器
dere daemon status               # 显示状态
dere queue list                  # 列出待处理任务
```

## 开发

```bash
just build      # 使用 uv 构建
just test       # 运行测试
just lint       # 使用 ruff 检查
just fmt        # 格式化代码
```
