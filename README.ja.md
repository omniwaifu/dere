# dere

[English](README.md) | [中文](README.zh.md) | 日本語

Claude CLI用の構成可能な性格レイヤーを持つ階層型AIアシスタント、埋め込みによる会話メモリ、インテリジェントなメッセージ要約、LLMベースのエンティティ抽出、包括的なメンタルヘルスとウェルネストラッキング機能付き。

**なぜこれを作ったのか：** 私はすべてにClaude Codeを使っていて、ターミナルを開いたときに「キャラクター」になってもらうのが好きです。例：`dere --personality tsun --mcp=spotify`

## 機能

- **性格レイヤー：** ツンデレ、クーデレ、ヤンデレ、デレデレなど
- **メンタルヘルスモード：** チェックイン、CBT、セラピー、マインドフルネス、目標追跡の専用モード
- **ウェルネスデータトラッキング：** 気分、エネルギー、ストレスの自動監視と構造化データ保存
- **ActivityWatch統合：** リアルタイムアクティビティと行動監視のためのMCPサーバー
- **会話メモリ：** 自動埋め込み生成と類似性検索
- **エンティティ抽出：** LLMベースのセマンティック抽出による技術、人物、概念、関係性の抽出
- **漸進的要約：** 動的コンテキスト制限を使用した情報損失ゼロの長い会話のインテリジェント要約
- **セマンティック会話継続：** 類似性検索を使用して以前の会話から関連コンテキストを構築
- **インテリジェント要約：** より良い埋め込みのための長いメッセージの自動要約
- **コンテキスト認識：** 時間、日付、天気、アクティビティトラッキング
- **MCP管理：** 独立MCPサーバー構成、プロファイルとスマートフィルタリング付き
- **出力スタイル：** 直交出力スタイルレイヤー（教育モード、詳細モードなど）
- **カスタム性格：** ユーザー上書き可能なTOMLベースの性格システムと表示カスタマイズ
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
- [ActivityWatch](https://activitywatch.net/)（オプション、アクティビティ監視とウェルネストラッキング用）

### クイックインストール（Linux/macOS）

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

これにより：
- メインdereバイナリをビルド
- dereバイナリとPythonフックスクリプトを~/.local/bin (Linux) または ~/Library/Application Support (macOS) にインストール
- 会話キャプチャ、セッション要約、デーモン通信を自動設定

### 手動セットアップ

#### Linux/macOS

1. プロジェクトをビルド：
```bash
just build
```

2. バイナリとスクリプトをPATHにコピー：
```bash
cp bin/dere ~/.local/bin/  # または /usr/local/bin/
cp hooks/python/*.py ~/.local/bin/
chmod +x ~/.local/bin/dere-*.py
```

#### Windows

1. プロジェクトをビルド：
```powershell
go build -o bin\dere.exe cmd\dere\main.go
```

2. `bin` ディレクトリをPATHに追加、またはPATH内の場所にコピー：
```powershell
copy bin\dere.exe %LOCALAPPDATA%\Programs\
copy hooks\python\*.py %LOCALAPPDATA%\Programs\
```

3. Pythonが `.py` ファイルに関連付けられていることを確認、またはClaude CLIがフックを呼び出す際に `python` プレフィックスを使用

3. Ollamaを設定（オプション、会話埋め込み用）：
```toml
# 設定ディレクトリ内のconfig.toml（ファイルの場所セクションを参照）
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # 要約を試みる前の文字数
```

4. 天気を設定（オプション）：
```toml
# 設定ディレクトリ内のconfig.toml（ファイルの場所セクションを参照）
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

### メンタルヘルス＆ウェルネスモード
```bash
dere --mode checkin               # 日常のメンタルヘルスチェックイン
dere --mode cbt                   # 認知行動療法セッション
dere --mode therapy               # 一般的なセラピーセッション
dere --mode mindfulness           # マインドフルネスと瞑想ガイダンス
dere --mode goals                 # 目標設定と追跡

# 異なる治療スタイルのために性格と組み合わせ
dere --mode therapy -P yan        # 過度に心配するセラピスト
dere --mode cbt -P kuu            # 臨床的、分析的CBTアプローチ
dere --mode checkin -P dere       # 温かく、励ましのチェックイン
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

### ファイルの場所

dereは各プラットフォームの慣例に従って設定ファイルとデータファイルを保存します：

**Linux/Unix:**
- 設定: `~/.config/dere/`
- データ: `~/.local/share/dere/`

**macOS:**
- 設定: `~/Library/Application Support/dere/`
- データ: `~/Library/Application Support/dere/`

**Windows:**
- 設定: `%LOCALAPPDATA%\dere\`
- データ: `%LOCALAPPDATA%\dere\`

### カスタム性格
性格はプロンプト、表示色、アイコンを含むTOMLファイルで定義されます。

**組み込み性格**（バイナリに埋め込み）：
- `tsun`（ツンデレ）- 厳しいが思いやりがある、赤
- `kuu`（クーデレ）- 冷静分析、青
- `yan`（ヤンデレ）- 過度に親切、マゼンタ
- `dere`（デレデレ）- 本当に優しい、緑
- `ero`（エロデレ）- 遊び心のあるからかい、黄色

**設定ディレクトリの`personalities/`配下にカスタム性格を作成**：
```toml
# Linux: ~/.config/dere/personalities/custom.toml
# macOS: ~/Library/Application Support/dere/personalities/custom.toml
# Windows: %LOCALAPPDATA%\dere\personalities\custom.toml
[metadata]
name = "custom-personality"
short_name = "custom"
aliases = ["custom", "my-personality"]

[display]
color = "cyan"        # ステータスライン色
icon = "●"            # ステータスラインアイコン

[prompt]
content = """
# 性格：カスタム

性格の説明をここに...

## コアトレイト：
- トレイト1
- トレイト2
"""
```

使用方法：`dere --personality custom`

### カスタムプロンプト
設定ディレクトリの`prompts/`配下にドメイン固有の知識として`.md`ファイルを配置：
- **Linux/Unix:** `~/.config/dere/prompts/rust.md`
- **macOS:** `~/Library/Application Support/dere/prompts/rust.md`
- **Windows:** `%LOCALAPPDATA%\dere\prompts\rust.md`

### MCPサーバー
設定ディレクトリ内の`mcp_config.json`で独立管理

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
dere daemon reload                 # 設定をリロード（SIGHUP、Linux/macOSのみ）

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
会話はTurso/libSQLを使用してデータディレクトリの`dere.db`に自動的に保存され、類似性検索用のベクトル埋め込みが含まれます：
- **Linux/Unix:** `~/.local/share/dere/dere.db`
- **macOS:** `~/Library/Application Support/dere/dere.db`
- **Windows:** `%LOCALAPPDATA%\dere\dere.db`

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
- 性格はTOMLベースで上書き可能です（ファイルの場所セクションを参照）
- Linux、macOS、Windowsのクロスプラットフォームサポート、各プラットフォームのディレクトリ規則に従います
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