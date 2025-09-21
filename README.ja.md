# dere

[English](README.md) | [中文](README.zh.md) | 日本語

Claude CLI用の構成可能な性格レイヤーを持つ階層型AIアシスタント、埋め込みによる会話メモリ、インテリジェントなメッセージ要約、LLMベースのエンティティ抽出機能付き。

**なぜこれを作ったのか：** 私はすべてにClaude Codeを使っていて、ターミナルを開いたときに「キャラクター」になってもらうのが好きです。例：`dere --personality tsun --mcp=spotify`

## 機能

- **性格レイヤー：** ツンデレ、クーデレ、ヤンデレ、デレデレなど
- **会話メモリ：** 自動埋め込み生成と類似性検索
- **エンティティ抽出：** LLMベースのセマンティック抽出による技術、人物、概念、関係性の抽出
- **漸進的要約：** 動的コンテキスト制限を使用した情報損失ゼロの長い会話のインテリジェント要約
- **セマンティック会話継続：** 類似性検索を使用して以前の会話から関連コンテキストを構築
- **インテリジェント要約：** より良い埋め込みのための長いメッセージの自動要約
- **コンテキスト認識：** 時間、日付、天気、アクティビティトラッキング
- **MCP管理：** 独立MCPサーバー構成、プロファイルとスマートフィルタリング付き
- **出力スタイル：** 直交出力スタイルレイヤー（教育モード、詳細モードなど）
- **動的コマンド：** セッションごとに自動生成される性格固有のスラッシュコマンド
- **カスタムプロンプト：** 独自のドメイン固有の知識を追加
- **ベクトル検索：** ネイティブベクトル類似性を持つTurso/libSQLデータベース
- **バックグラウンド処理：** 埋め込みと要約用のデーモンとタスクキュー
- **Claude CLI互換性：** `-p`、`--debug`、`--verbose`などのClaudeフラグの完全サポート
- **ステータスライン：** リアルタイムの性格とキューステータス表示

## インストール

### 必要条件

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+（ビルド用）
- Python 3.8+（フックスクリプト用）
- [Just](https://github.com/casey/just)（オプション、モダンビルドコマンド用）
- [Ollama](https://ollama.ai)（オプション、埋め込みと要約用）
- [rustormy](https://github.com/Tairesh/rustormy)（オプション、天気コンテキスト用）

### クイックインストール

```bash
git clone https://github.com/yourusername/dere.git
cd dere
just install  # または 'make install' を使用
```

これにより：
- メインdereバイナリをビルド
- dereバイナリとPythonフックスクリプトを~/.local/binにインストール
- 会話キャプチャ、セッション要約、デーモン通信を自動設定

### 手動セットアップ

1. プロジェクトをビルド：
```bash
just build  # または 'make build'
```

2. バイナリとスクリプトをPATHにコピーまたはリンク：
```bash
cp bin/dere ~/.local/bin/  # または /usr/local/bin/
cp hooks/python/dere-hook.py ~/.local/bin/dere-hook
cp hooks/python/dere-hook-session-end.py ~/.local/bin/dere-hook-session-end
cp hooks/python/dere-statusline.py ~/.local/bin/dere-statusline
cp hooks/python/dere-stop-hook.py ~/.local/bin/dere-stop-hook
cp hooks/python/rpc_client.py ~/.local/bin/
chmod +x ~/.local/bin/dere-*
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
dere --personality tsun           # ツンデレモード（厳しいが思いやりがある）
dere -P kuu                       # クーデレ（冷静分析）
dere --personality yan            # ヤンデレ（過度に親切）
dere -P dere                      # デレデレ（本当に優しい）
dere --personality ero            # エロデレ（いたずらっぽい）
dere --bare                       # プレーンClaude、性格なし

# 複数の性格
dere -P tsun,kuu                  # ツンデレ + クーデレの組み合わせ
dere --personality "yan,ero"       # ヤンデレ + エロデレの組み合わせ
```

### 高度な機能
```bash
dere --context                    # 時間/日付/天気/アクティビティコンテキストを追加
dere -c                          # 前の会話を継続
dere --context-depth=10          # セマンティックコンテキスト検索の深度を制御
dere --context-mode=smart        # コンテキストモードを設定（summary/full/smart）
dere --prompts=rust,security     # カスタムプロンプトをロード
dere --mcp=dev                   # MCPプロファイルを使用
dere --mcp="linear,obsidian"      # 特定MCPサーバーを使用
dere --mcp="tag:media"            # タグでMCPサーバーを使用
dere --output-style=verbose      # Claudeの出力スタイルを変更

# Claude CLIパススルー（完全互換）
dere -p "hello world"             # プリントモード（非インタラクティブ）
dere --debug api                 # フィルタリング付きデバッグモード
dere --verbose                   # 詳細出力モード
dere --output-format json        # JSON出力形式
```

### レイヤーの組み合わせ
```bash
dere -P tsun --context                    # ツンデレ + コンテキスト認識
dere --personality kuu --mcp=spotify     # クール + Spotify制御
dere -P yan --output-style=terse         # ヤンデレ + 簡潔な応答
dere --prompts=go --context              # Go専門知識 + コンテキスト
dere -P tsun,kuu -p "このコードを修正"        # 複数性格 + プリントモード
```

## 設定

### カスタムプロンプト
`~/.config/dere/prompts/`に`.md`ファイルを配置：
```bash
~/.config/dere/prompts/rust.md     # --prompts=rust
~/.config/dere/prompts/security.md # --prompts=security
```

### MCPサーバー
`~/.config/dere/mcp_config.json`で独立管理

```bash
# MCP管理コマンド
dere mcp list                      # 設定されたサーバーをリスト
dere mcp profiles                  # 利用可能なプロファイルを表示
dere mcp add <name> <command>      # 新しいサーバーを追加
dere mcp remove <name>             # サーバーを削除
dere mcp copy-from-claude          # Claude Desktopからインポート

# MCPサーバーの使用
dere --mcp=dev                     # 'dev'プロファイルを使用
dere --mcp="linear,obsidian"       # 特定サーバーを使用
dere --mcp="*spotify*"             # パターンマッチング
dere --mcp="tag:media"             # タグベース選択
```

### デーモンとキュー管理
埋め込み、要約、その他のLLMタスクのバックグラウンド処理：

```bash
# デーモン管理
dere daemon start                  # バックグラウンドタスクプロセッサを開始
dere daemon stop                   # デーモンを停止
dere daemon restart                # デーモンを再起動（ホットリロード）
dere daemon status                 # デーモンステータス、PID、キュー統計を表示
dere daemon reload                 # 設定をリロード（SIGHUP）

# キュー管理
dere queue list                    # 保留中のタスクをリスト
dere queue stats                   # キュー統計を表示
dere queue process                 # 保留中のタスクを手動処理
```

### セッション要約
自動生成されたセッション要約の表示と管理：

```bash
# 要約管理
dere summaries list                # すべてのセッション要約をリスト
dere summaries list --project=/path  # プロジェクトパスでフィルタ
dere summaries show <id>           # 詳細要約を表示
```

### エンティティ管理
会話から抽出されたエンティティは自動的に保存され、CLIコマンドで管理できます：

```bash
# エンティティ管理コマンド
dere entities list                 # すべての抽出されたエンティティをリスト
dere entities list --type=technology  # エンティティタイプでフィルタ
dere entities list --project=/path    # プロジェクトパスでフィルタ
dere entities search "react"       # 値でエンティティを検索
dere entities graph                # エンティティ関係グラフを表示
dere entities graph React          # 特定エンティティの関係を表示
```

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
│   └── dere/                    # メインCLIエントリーポイント
├── src/
│   ├── commands/                # 動的コマンド生成
│   ├── composer/                # プロンプト構成
│   ├── config/                  # 設定管理
│   ├── daemon/                  # バックグラウンドデーモンサーバー
│   ├── database/                # ベクトル検索付きTurso/libSQL
│   ├── embeddings/              # Ollama埋め込みクライアント
│   ├── mcp/                     # MCPサーバー管理
│   ├── settings/                # Claude設定生成
│   ├── taskqueue/               # バックグラウンドタスク処理
│   └── weather/                 # 天気コンテキスト統合
├── hooks/
│   └── python/                  # Pythonフックスクリプト
│       ├── dere-hook.py         # 会話キャプチャフック
│       ├── dere-hook-session-end.py  # セッション終了フック
│       ├── dere-statusline.py   # ステータスライン表示
│       ├── dere-stop-hook.py    # キャプチャ停止フック
│       └── rpc_client.py        # RPC通信クライアント
├── prompts/                     # ビルトイン性格プロンプト
└── scripts/                     # インストールスクリプト
```

### ソースからビルド
```bash
just build      # メインバイナリをビルド
just clean      # ビルド成果物をクリーン
just install    # ビルドして~/.local/binにインストール
just test       # テストを実行
just lint       # リンティングを実行
just dev        # 開発デーモンを開始
just --list     # 利用可能なコマンドをすべて表示
```

従来のmakeも使用可能：
```bash
make build      # バイナリをビルド
make clean      # ビルド成果物をクリーン
make install    # ビルドしてインストール
```

### データベーススキーマ
会話データベースは漸進的要約サポート付きlibSQLのネイティブベクトル型を使用：
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

CREATE TABLE conversation_segments (
    id INTEGER PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    segment_number INTEGER NOT NULL,
    segment_summary TEXT NOT NULL,
    original_length INTEGER NOT NULL,
    summary_length INTEGER NOT NULL,
    start_conversation_id INTEGER REFERENCES conversations(id),
    end_conversation_id INTEGER REFERENCES conversations(id),
    model_used TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, segment_number)
);

CREATE INDEX conversations_embedding_idx
ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'));
```

## 注意事項

- データベースと埋め込みは初回使用時に自動的に作成されます
- Ollamaはオプションですが、会話類似性検索と漸進的要約を有効にします
- グローバル設定を変更せずに既存のClaude CLI設定と一緒に動作します
- `--settings`フラグによる動的設定生成でClaude設定をクリーンに保ちます
- 性格コマンド（例：`/dere-tsun-rant`）は`~/.claude/commands/`でセッションごとに作成されます
- MCP設定はClaude Desktopから独立してより良い制御を実現
- 漸進的要約は動的コンテキスト長クエリで情報損失ゼロを実現
- バックグラウンドデーモンはモデル切り替え最適化とPIDベースのステータス監視で効率的にタスクを処理
- デーモンは起動時に古いファイルをクリーンアップし、プロセスを適切に管理
- 30分TTLのコンテキストキャッシュシステム
- 会話継続は埋め込みと類似性検索を使用して関連コンテキストを見つけます
- パススルーフラグサポートによる完全Claude CLI互換性
- ステータスラインはリアルタイムの性格、デーモンステータス、キュー統計を表示
- ベクトル検索はコサイン類似度を使用して関連する会話を見つけます
- **Pythonフック**：会話キャプチャと処理で開発とカスタマイズを容易にするためにGoバイナリの代わりにPythonスクリプトを使用
- **RPC通信**：フックは効率的なバックグラウンド処理のためにRPC経由でデーモンと通信
- **停止フック**：会話連続性を改善するためにClaude応答をキャプチャする新しい停止フック

## ライセンス

MIT