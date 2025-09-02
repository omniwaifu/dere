# dere

[English](README.md) | [中文](README.zh.md) | 日本語

**なぜこれを作ったのか：** 私はすべてにClaude Codeを使っていて、ターミナルを開いたときに「キャラクター」になってもらうのが好きです。例：`dere --tsun --mcp=spotify`

Claude CLI用の構成可能な性格レイヤーを持つ階層型AIアシスタント。

**ビルド：** `make`

**使用法：**
- `dere --tsun` - ツンデレモード  
- `dere --kuu` - クール分析
- `dere --yan` - 過度に親切  
- `dere --dere` - 本当に優しい
- `dere --ero` - いたずらっぽい
- `dere --bare` - プレーンClaude
- `dere --context` - 時間/日付コンテキストを追加
- `dere --custom-prompt` - `~/.config/dere/prompts/custom-prompt.md` からのカスタムプロンプト
- `dere --mcp=server1,server2` - `~/.claude/claude_desktop_config.json` からのMCPサーバー

**カスタムプロンプト：** `~/.config/dere/prompts/*.md` **MCP：** Claude Desktopの設定から解析