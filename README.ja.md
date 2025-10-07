# dere

[English](README.md) | [中文](README.zh.md) | 日本語

会話メモリ、埋め込み、メンタルヘルストラッキング機能を備えたClaude CLI用のパーソナリティラッパー。

**なぜ：** すべてにClaude Codeを使っているので、ターミナルを開いたときに「キャラクター」になってほしい。

## インストール

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

**必要条件：**
- [Claude CLI](https://github.com/anthropics/claude-cli)
- Python 3.13+
- [uv](https://github.com/astral-sh/uv)
- [Ollama](https://ollama.ai)（オプション、埋め込み用）

## 使い方

```bash
dere --personality tsun          # ツンデレ（厳しいけど優しい）
dere -P kuu                      # クーデレ（冷静分析的）
dere --personality yan           # ヤンデレ（過度に親切）
dere -P dere                     # デレデレ（素直に優しい）
dere --bare                      # 素のClaude

# メンタルヘルスモード
dere --mode checkin              # 日次チェックイン
dere --mode cbt                  # CBTセッション
dere --mode therapy              # セラピーセッション

# 機能
dere --context                   # 時間/日付/天気コンテキストを追加
dere -c                          # 前の会話を続ける
dere --prompts=rust,security     # カスタムプロンプトをロード
dere --mcp=dev                   # MCPプロファイルを使用
```

## Discord Bot（実験的）

```bash
uv run dere-discord --persona tsun
```

`~/.config/dere/config.toml`で設定：

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

## 設定

**設定：** `~/.config/dere/`（Linux）、`~/Library/Application Support/dere/`（macOS）
**データ：** `~/.local/share/dere/`（Linux）、`~/Library/Application Support/dere/`（macOS）

### カスタムパーソナリティ

`~/.config/dere/personalities/custom.toml`を作成：

```toml
[metadata]
name = "custom"
aliases = ["custom"]

[display]
color = "cyan"
icon = "●"

[prompt]
content = """
ここにパーソナリティの説明を書く...
"""
```

### カスタムプロンプト

ドメイン固有の知識として`.md`ファイルを`~/.config/dere/prompts/`に追加。

### デーモン

```bash
dere daemon start                # バックグラウンドプロセッサを起動
dere daemon status               # ステータスを表示
dere queue list                  # 保留中のタスクをリスト
```

## 開発

```bash
just build      # uvでビルド
just test       # テストを実行
just lint       # ruffでリント
just fmt        # コードをフォーマット
```
