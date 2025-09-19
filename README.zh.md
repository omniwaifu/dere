# dere

[English](README.md) | 中文 | [日本語](README.ja.md)

为 Claude CLI 提供可组合人格层的分层 AI 助手，具有通过嵌入的对话记忆、智能消息摘要和基于 LLM 的实体提取功能。

**为什么要这样做：** 我在所有事情上都使用 Claude Code，我喜欢在打开终端时让它保持"角色扮演"，例如 `dere --tsun --mcp=spotify`

## 功能特性

- **人格层：** 傲娇、冷娇、病娇、甜娇等多种人格
- **对话记忆：** 自动嵌入生成和相似性搜索
- **实体提取：** 基于 LLM 的语义提取技术、人物、概念和关系
- **智能摘要：** 长消息自动摘要以获得更好的嵌入
- **上下文感知：** 时间、日期、天气和活动跟踪
- **MCP 管理：** 独立的 MCP 服务器配置，支持配置文件和智能过滤
- **输出样式：** 正交输出样式层（如教学模式、详细模式）
- **动态命令：** 每个会话自动生成的个性特定斜杠命令
- **自定义提示：** 添加您自己的领域特定知识
- **向量搜索：** 带有原生向量相似性的 Turso/libSQL 数据库

## 安装

### 要求

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+（用于构建）
- [Ollama](https://ollama.ai)（可选，用于嵌入和摘要）
- [rustormy](https://github.com/yourusername/rustormy)（可选，用于天气上下文）

### 快速安装

```bash
git clone https://github.com/yourusername/dere.git
cd dere
make install
```

这将：
- 构建主二进制文件和钩子
- 安装到 /usr/local/bin
- 创建必要的配置目录
- 自动设置对话捕获

### 手动设置

1. 构建项目：
```bash
make build
```

2. 复制或链接二进制文件到您的 PATH：
```bash
cp bin/dere /usr/local/bin/
cp bin/dere-hook /usr/local/bin/
ln -s $(pwd)/bin/dere-hook ~/.config/dere/.claude/hooks/dere-hook
```

3. 配置 Ollama（可选，用于对话嵌入）：
```toml
# ~/.config/dere/config.toml
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # 尝试摘要前的字符数
```

4. 配置天气（可选）：
```toml
# ~/.config/dere/config.toml
[weather]
enabled = true
location = "Beijing, China"
units = "metric"  # 或 "imperial"
```

## 使用方法

### 基本人格
```bash
dere --tsun              # 傲娇模式（严厉但关心）
dere --kuu               # 冷娇（冷静分析）
dere --yan               # 病娇（过度热心）
dere --dere              # 甜娇（真正友善）
dere --ero               # 色娇（调皮戏弄）
dere --bare              # 纯净 Claude，无人格
```

### 高级功能
```bash
dere --context           # 添加时间/日期/天气/活动上下文
dere -c                  # 继续上次对话
dere --prompts=rust,security  # 加载自定义提示
dere --mcp=filesystem    # 使用 Claude Desktop 的 MCP 服务器
```

### 组合层
```bash
dere --tsun --context              # 傲娇 + 上下文感知
dere --kuu --mcp=spotify           # 冷静 + Spotify 控制
dere --prompts=go --context        # Go 专业知识 + 上下文
```

## 配置

### 自定义提示
在 `~/.config/dere/prompts/` 中放置 `.md` 文件：
```bash
~/.config/dere/prompts/rust.md     # --prompts=rust
~/.config/dere/prompts/security.md # --prompts=security
```

### MCP 服务器
使用来自 `~/.claude/claude_desktop_config.json` 的现有 Claude Desktop 配置

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
对话使用 Turso/libSQL 自动存储在 `~/.local/share/dere/conversations.db` 中，带有用于相似性搜索的向量嵌入。

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
│   ├── dere/          # 主 CLI 入口点
│   └── dere-hook/     # 用于对话捕获的 Go 钩子
├── src/
│   ├── cli/           # CLI 参数解析
│   ├── composer/      # 提示组合
│   ├── config/        # 配置管理
│   ├── database/      # 带有向量搜索的 Turso/libSQL
│   ├── embeddings/    # Ollama 嵌入客户端
│   ├── hooks/         # Claude CLI 钩子管理
│   ├── mcp/           # MCP 服务器配置
│   └── weather/       # 天气上下文集成
├── prompts/           # 内置人格提示
└── scripts/           # 安装脚本
```

### 从源代码构建
```bash
make build      # 构建二进制文件
make clean      # 清理构建产物
make install    # 构建并安装到 /usr/local/bin
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
- Ollama 是可选的，但可以启用对话相似性搜索和摘要
- 与现有 Claude CLI 配置一起工作
- 钩子仅对 dere 会话激活，不影响常规 Claude 使用
- 摘要使用 gemma3n 模型高效处理长消息
- 向量搜索使用余弦相似度查找相关对话

## 许可证

MIT