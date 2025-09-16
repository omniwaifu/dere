# dere

[English](README.md) | [中文](README.zh.md) | 日本語

Claude CLI用の構成可能な性格レイヤーを持つ階層型AIアシスタント、埋め込みによる会話メモリとインテリジェントなメッセージ要約機能付き。

**なぜこれを作ったのか：** 私はすべてにClaude Codeを使っていて、ターミナルを開いたときに「キャラクター」になってもらうのが好きです。例：`dere --tsun --mcp=spotify`

## 機能

- **性格レイヤー：** ツンデレ、クーデレ、ヤンデレ、デレデレなど
- **会話メモリ：** 自動埋め込み生成と類似性検索
- **インテリジェント要約：** より良い埋め込みのための長いメッセージの自動要約
- **コンテキスト認識：** 時間、日付、天気、アクティビティトラッキング
- **MCP統合：** Claude Desktop MCPサーバーと使用
- **カスタムプロンプト：** 独自のドメイン固有の知識を追加
- **ベクトル検索：** ネイティブベクトル類似性を持つTurso/libSQLデータベース

## インストール

### 必要条件

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+（ビルド用）
- [Ollama](https://ollama.ai)（オプション、埋め込みと要約用）
- [rustormy](https://github.com/yourusername/rustormy)（オプション、天気コンテキスト用）

### クイックインストール

```bash
git clone https://github.com/yourusername/dere.git
cd dere
make install
```

これにより：
- メインバイナリとフックをビルド
- /usr/local/binにインストール
- 必要な設定ディレクトリを作成

### 手動セットアップ

1. プロジェクトをビルド：
```bash
make build
```

2. フックを設定：
```bash
mkdir -p ~/.config/dere/.claude/hooks
ln -s $(pwd)/bin/dere-hook ~/.config/dere/.claude/hooks/dere-hook
```

3. Ollamaを設定（オプション、会話埋め込み用）：
```toml
# ~/.config/dere/config.toml
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # 要約を試みる前の文字数
```

4. 天気を設定（オプション）：
```toml
# ~/.config/dere/config.toml
[weather]
enabled = true
location = "Tokyo, Japan"
units = "metric"  # または "imperial"
```

## 使用方法

### 基本的な性格
```bash
dere --tsun              # ツンデレモード（厳しいが思いやりがある）
dere --kuu               # クーデレ（冷静分析）
dere --yan               # ヤンデレ（過度に親切）
dere --dere              # デレデレ（本当に優しい）
dere --ero               # エロデレ（いたずらっぽい）
dere --bare              # プレーンClaude、性格なし
```

### 高度な機能
```bash
dere --context           # 時間/日付/天気/アクティビティコンテキストを追加
dere -c                  # 前の会話を継続
dere --prompts=rust,security  # カスタムプロンプトをロード
dere --mcp=filesystem    # Claude DesktopのMCPサーバーを使用
```

### レイヤーの組み合わせ
```bash
dere --tsun --context              # ツンデレ + コンテキスト認識
dere --kuu --mcp=spotify           # クール + Spotify制御
dere --prompts=go --context        # Go専門知識 + コンテキスト
```

## 設定

### カスタムプロンプト
`~/.config/dere/prompts/`に`.md`ファイルを配置：
```bash
~/.config/dere/prompts/rust.md     # --prompts=rust
~/.config/dere/prompts/security.md # --prompts=security
```

### MCPサーバー
`~/.claude/claude_desktop_config.json`からの既存のClaude Desktop設定を使用

### 会話データベース
会話は`~/.local/share/dere/conversations.db`にTurso/libSQLを使用して自動的に保存され、類似性検索用のベクトル埋め込みが含まれます。

#### メッセージ処理
- 500文字未満のメッセージ：直接保存
- 500-2000文字のメッセージ：キーとなる用語を保持した軽量要約
- 2000文字を超えるメッセージ：セマンティック検索用の抽出要約
- すべての埋め込みはmxbai-embed-largeからの1024次元ベクトルを使用

## 開発

### プロジェクト構造
```
dere/
├── cmd/
│   ├── dere/          # メインCLIエントリーポイント
│   └── dere-hook/     # 会話キャプチャ用Goフック
├── src/
│   ├── cli/           # CLI引数解析
│   ├── composer/      # プロンプト構成
│   ├── config/        # 設定管理
│   ├── database/      # ベクトル検索付きTurso/libSQL
│   ├── embeddings/    # Ollama埋め込みクライアント
│   ├── hooks/         # Claude CLIフック管理
│   ├── mcp/           # MCPサーバー設定
│   └── weather/       # 天気コンテキスト統合
├── prompts/           # ビルトイン性格プロンプト
└── scripts/           # インストールスクリプト
```

### ソースからビルド
```bash
make build      # バイナリをビルド
make clean      # ビルド成果物をクリーン
make install    # ビルドして/usr/local/binにインストール
```

### データベーススキーマ
会話データベースはlibSQLのネイティブベクトル型を使用：
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

## 注意事項

- データベースと埋め込みは初回使用時に自動的に作成されます
- Ollamaはオプションですが、会話類似性検索と要約を有効にします
- 既存のClaude CLI設定と一緒に動作します
- フックはdereセッションでのみ有効化され、通常のClaude使用には影響しません
- 要約はgemma3nモデルを使用して長いメッセージを効率的に処理します
- ベクトル検索はコサイン類似度を使用して関連する会話を見つけます

## ライセンス

MIT