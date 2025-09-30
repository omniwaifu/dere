# dere

[English](README.md) | 中文 | [日本語](README.ja.md)

为 Claude CLI 提供可组合人格层的分层 AI 助手，具有通过嵌入的对话记忆、智能消息摘要、基于 LLM 的实体提取和全面的心理健康与健康跟踪功能。

**为什么要这样做：** 我在所有事情上都使用 Claude Code，我喜欢在打开终端时让它保持"角色扮演"，例如 `dere --personality tsun --mcp=spotify`

## 功能特性

- **人格层：** 傲娇、冷娇、病娇、甜娇等多种人格
- **心理健康模式：** 专用于签到、CBT、治疗、正念和目标跟踪的特殊模式
- **健康数据跟踪：** 自动情绪、精力和压力监测，结构化数据存储
- **ActivityWatch 集成：** 用于实时活动和行为监测的 MCP 服务器
- **对话记忆：** 自动嵌入生成和相似性搜索
- **实体提取：** 基于 LLM 的语义提取技术、人物、概念和关系
- **渐进式摘要：** 使用动态上下文限制的零损失智能摘要处理长对话
- **语义会话延续：** 使用相似性搜索从之前对话智能构建上下文
- **智能摘要：** 长消息自动摘要以获得更好的嵌入
- **上下文感知：** 时间、日期、天气和活动跟踪
- **MCP 管理：** 独立的 MCP 服务器配置，支持配置文件和智能过滤
- **输出样式：** 正交输出样式层（如教学模式、详细模式）
- **自定义人格：** 基于 TOML 的用户可覆盖人格系统，支持显示自定义
- **自定义提示：** 添加您自己的领域特定知识
- **向量搜索：** 带有原生向量相似性的 Turso/libSQL 数据库
- **后台处理：** 用于嵌入和摘要的守护进程和任务队列
- **Claude CLI 兼容性：** 完全支持 Claude 标志如 `-p`、`--debug`、`--verbose`
- **状态栏：** 实时个性和队列状态显示

## 安装

### 要求

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+（用于构建）
- Python 3.8+（用于钩子脚本）
- [Just](https://github.com/casey/just)（可选，用于现代构建命令）
- [Ollama](https://ollama.ai)（可选，用于嵌入和摘要）
- [rustormy](https://github.com/yourusername/rustormy)（可选，用于天气上下文）
- [ActivityWatch](https://activitywatch.net/)（可选，用于活动监测和健康跟踪）

### 快速安装

```bash
git clone https://github.com/yourusername/dere.git
cd dere
just install  # 或者使用 'make install'
```

这将：
- 构建主 dere 二进制文件
- 安装 dere 二进制文件和 Python 钩子脚本到 ~/.local/bin
- 自动设置对话捕获、会话摘要和守护进程通信

### 手动设置

1. 构建项目：
```bash
just build  # 或者 'make build'
```

2. 复制或链接二进制文件和脚本到您的 PATH：
```bash
cp bin/dere ~/.local/bin/  # 或者 /usr/local/bin/
cp hooks/python/dere-hook.py ~/.local/bin/dere-hook
cp hooks/python/dere-hook-session-end.py ~/.local/bin/dere-hook-session-end
cp hooks/python/dere-statusline.py ~/.local/bin/dere-statusline
cp hooks/python/dere-stop-hook.py ~/.local/bin/dere-stop-hook
cp hooks/python/rpc_client.py ~/.local/bin/
chmod +x ~/.local/bin/dere-*
```

3. 配置 Ollama（可选，用于对话嵌入）：
```toml
# 配置目录中的 config.toml（参见文件位置部分）
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # 尝试摘要前的字符数
```

4. 配置天气（可选）：
```toml
# 配置目录中的 config.toml（参见文件位置部分）
[weather]
enabled = true
location = "Beijing, China"
units = "metric"  # 或 "imperial"
```

## 使用方法

### 基本人格
```bash
dere --personality tsun           # 傲娇模式（严厉但关心）
dere -P kuu                       # 冷娇（冷静分析）
dere --personality yan            # 病娇（过度热心）
dere -P dere                      # 甜娇（真正友善）
dere --personality ero            # 色娇（调皮戏弄）
dere --bare                       # 纯净 Claude，无人格

# 多重人格
dere -P tsun,kuu                  # 组合傲娇 + 冷娇
dere --personality "yan,ero"       # 组合病娇 + 色娇
```

### 高级功能
```bash
dere --context                    # 添加时间/日期/天气/活动上下文
dere -c                          # 继续上次对话
dere --context-depth=10          # 控制语义上下文搜索深度
dere --context-mode=smart        # 设置上下文模式（summary/full/smart）
dere --prompts=rust,security     # 加载自定义提示
dere --mcp=dev                   # 使用 MCP 配置文件
dere --mcp="linear,obsidian"      # 使用特定 MCP 服务器
dere --mcp="tag:media"            # 使用标签选择 MCP 服务器
dere --output-style=verbose      # 更改 Claude 输出样式

# Claude CLI 透传（完全兼容）
dere -p "hello world"             # 打印模式（非交互）
dere --debug api                 # 调试模式带过滤
dere --verbose                   # 详细输出模式
dere --output-format json        # JSON 输出格式
```

### 组合层
```bash
dere -P tsun --context                    # 傲娇 + 上下文感知
dere --personality kuu --mcp=spotify     # 冷静 + Spotify 控制
dere -P yan --output-style=terse         # 病娇 + 简洁回应
dere --prompts=go --context              # Go 专业知识 + 上下文
dere -P tsun,kuu -p "修复这段代码"        # 多重人格 + 打印模式
```

## 配置

### 文件位置

dere 遵循各平台约定存储配置和数据文件：

**Linux/Unix:**
- 配置: `~/.config/dere/`
- 数据: `~/.local/share/dere/`

**macOS:**
- 配置: `~/Library/Application Support/dere/`
- 数据: `~/Library/Application Support/dere/`

**Windows:**
- 配置: `%LOCALAPPDATA%\dere\`
- 数据: `%LOCALAPPDATA%\dere\`

### 自定义人格
人格定义在 TOML 文件中，包含提示词、显示颜色和图标。

**内置人格**（嵌入到二进制文件中）：
- `tsun`（傲娇）- 严厉但关心，红色
- `kuu`（冷娇）- 冷静分析，蓝色
- `yan`（病娇）- 过度热心，品红
- `dere`（甜娇）- 真正友善，绿色
- `ero`（色娇）- 俏皮戏谑，黄色

**在配置目录的 `personalities/` 下创建自定义人格**：
```toml
# Linux: ~/.config/dere/personalities/custom.toml
# macOS: ~/Library/Application Support/dere/personalities/custom.toml
# Windows: %LOCALAPPDATA%\dere\personalities\custom.toml
[metadata]
name = "custom-personality"
short_name = "custom"
aliases = ["custom", "my-personality"]

[display]
color = "cyan"        # 状态栏颜色
icon = "●"            # 状态栏图标

[prompt]
content = """
# 人格：自定义

您的人格描述...

## 核心特征：
- 特征 1
- 特征 2
"""
```

使用方法：`dere --personality custom`

### 自定义提示
在配置目录的 `prompts/` 下放置 `.md` 文件作为领域特定知识：
- **Linux/Unix:** `~/.config/dere/prompts/rust.md`
- **macOS:** `~/Library/Application Support/dere/prompts/rust.md`
- **Windows:** `%LOCALAPPDATA%\dere\prompts\rust.md`

### MCP 服务器
在配置目录中作为 `mcp_config.json` 独立管理

```bash
# MCP 管理命令
dere mcp list                      # 列出配置的服务器
dere mcp profiles                  # 显示可用配置文件
dere mcp add <name> <command>      # 添加新服务器
dere mcp remove <name>             # 删除服务器
dere mcp copy-from-claude          # 从 Claude Desktop 导入

# 使用 MCP 服务器
dere --mcp=dev                     # 使用 'dev' 配置文件
dere --mcp="linear,obsidian"       # 使用特定服务器
dere --mcp="*spotify*"             # 模式匹配
dere --mcp="tag:media"             # 基于标签选择
```

### 守护进程和队列管理
用于嵌入、摘要和其他 LLM 任务的后台处理：

```bash
# 守护进程管理
dere daemon start                  # 启动后台任务处理器
dere daemon stop                   # 停止守护进程
dere daemon restart                # 重启守护进程（热重载）
dere daemon status                 # 显示守护进程状态、PID 和队列统计
dere daemon reload                 # 重载配置（SIGHUP）

# 队列管理
dere queue list                    # 列出待处理任务
dere queue stats                   # 显示队列统计
dere queue process                 # 手动处理待处理任务
```

### 会话摘要
查看和管理自动生成的会话摘要：

```bash
# 摘要管理
dere summaries list                # 列出所有会话摘要
dere summaries list --project=/path  # 按项目路径过滤
dere summaries show <id>           # 显示详细摘要
```

### 实体管理
从对话中提取的实体会自动存储，并可以通过 CLI 命令进行管理：

```bash
# 实体管理命令
dere entities list                 # 列出所有提取的实体
dere entities list --type=technology  # 按实体类型过滤
dere entities list --project=/path    # 按项目路径过滤
dere entities search "react"       # 按值搜索实体
dere entities graph                # 显示实体关系图
dere entities graph React          # 显示特定实体的关系
```

### 对话数据库
对话使用 Turso/libSQL 自动存储在数据目录的 `dere.db` 中，带有用于相似性搜索的向量嵌入：
- **Linux/Unix:** `~/.local/share/dere/dere.db`
- **macOS:** `~/Library/Application Support/dere/dere.db`
- **Windows:** `%LOCALAPPDATA%\dere\dere.db`

#### 消息处理
- 500 字符以下的消息：直接存储
- 500-2000 字符的消息：轻量摘要，保留关键术语
- 超过 2000 字符的消息：用于语义搜索的提取式摘要
- 所有嵌入使用来自 mxbai-embed-large 的 1024 维向量

## 开发

### 项目结构
```
dere/
├── cmd/
│   └── dere/                    # 主 CLI 入口点
├── src/
│   ├── commands/                # 动态命令生成
│   ├── composer/                # 提示组合
│   ├── config/                  # 配置管理
│   ├── daemon/                  # 后台守护进程服务器
│   ├── database/                # 带有向量搜索的 Turso/libSQL
│   ├── embeddings/              # Ollama 嵌入客户端
│   ├── mcp/                     # MCP 服务器管理
│   ├── settings/                # Claude 设置生成
│   ├── taskqueue/               # 后台任务处理
│   └── weather/                 # 天气上下文集成
├── hooks/
│   └── python/                  # Python 钩子脚本
│       ├── dere-hook.py         # 对话捕获钩子
│       ├── dere-hook-session-end.py  # 会话结束钩子
│       ├── dere-statusline.py   # 状态栏显示
│       ├── dere-stop-hook.py    # 停止钩子捕获
│       └── rpc_client.py        # RPC 通信客户端
├── prompts/                     # 内置人格提示
└── scripts/                     # 安装脚本
```

### 从源代码构建
```bash
just build      # 构建主二进制文件
just clean      # 清理构建产物
just install    # 构建并安装到 ~/.local/bin
just test       # 运行测试
just lint       # 运行代码检查
just dev        # 启动开发守护进程
just --list     # 显示所有可用命令
```

或使用传统 make：
```bash
make build      # 构建二进制文件
make clean      # 清理构建产物
make install    # 构建并安装
```

### 数据库架构
对话数据库使用 libSQL 的原生向量类型：
```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    project_path TEXT,
    personality TEXT,
    prompt TEXT,
    embedding_text TEXT,
    processing_mode TEXT,
    prompt_embedding FLOAT32(1024),
    timestamp INTEGER,
    created_at TIMESTAMP
);

CREATE INDEX conversations_embedding_idx 
ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'));
```

## 注意事项

- 数据库和嵌入在首次使用时自动创建
- Ollama 是可选的，但可以启用对话相似性搜索和渐进式摘要
- 与现有 Claude CLI 配置一起工作，不修改全局设置
- 通过 `--settings` 标志动态生成设置，保持 Claude 配置干净
- 人格基于 TOML，可覆盖（参见文件位置部分）
- 跨平台支持 Linux、macOS 和 Windows，遵循各平台目录约定
- MCP 配置独立于 Claude Desktop，便于更好控制
- 渐进式摘要使用动态上下文长度查询，实现零信息损失
- 后台守护进程通过模型切换优化和基于 PID 的状态监控高效处理任务
- 守护进程在启动时清理陈旧文件并正确管理进程
- 上下文缓存系统，30 分钟 TTL
- 会话延续使用嵌入和相似性搜索查找相关上下文
- 通过透传标志支持完全兼容 Claude CLI
- 状态栏显示实时个性、守护进程状态和队列统计
- 向量搜索使用余弦相似度查找相关对话
- **Python 钩子**：对话捕获和处理现在使用 Python 脚本而非 Go 二进制文件，便于开发和自定义
- **RPC 通信**：钩子通过 RPC 与守护进程通信，实现高效后台处理
- **停止钩子**：新的停止钩子捕获 Claude 响应，改善对话连续性

## 许可证

MIT