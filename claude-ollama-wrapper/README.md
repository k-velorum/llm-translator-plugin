# Claude Ollama Wrapper

Ollama互換のAPIエンドポイントを提供するラッパーサーバーです。デフォルトではClaude APIをバックエンドとして使用しますが、エンドポイント設定を変更することで他のAPIプロバイダーも利用可能です。

## ⚠️ 重要な注意事項

### API利用について

このラッパーは **API（従量課金型）での利用を想定** しています。

- ✅ **対応**: APIキーによる従量課金型サービス
- ❌ **非対応**: サブスクリプションプラン（Pro/Team/Enterprise等のWebインターフェース用プラン）

サブスクリプションプランはWebインターフェースでの利用を目的としており、API経由でのプログラム的なアクセスは提供されていません。利用するAPIプロバイダーのコンソールから発行されたAPIキーが必要です。

### セキュリティと利用規約

**⛔ このエンドポイントを外部（インターネット）に公開しないでください。**

- このサーバーを外部に公開すると、**利用しているAPIプロバイダーの利用規約に違反する可能性があります**
- APIキーの漏洩リスクが高まります
- 意図しない第三者によるAPI利用（課金）が発生する可能性があります

**推奨される使用方法:**
- `localhost` のみでの利用（デフォルト設定）
- プライベートネットワーク内での個人利用のみ
- 外部からアクセス可能なサーバーへのデプロイは避けてください

## 起動方法

```bash
# リポジトリのルートディレクトリで実行
docker-compose up --build
```

サーバーは `http://localhost:11434` で起動します。

## 設定

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `PORT` | サーバーポート | 11434 |
| `HOST` | バインドするホスト | 0.0.0.0 |
| `ALLOWED_ORIGINS` | CORS許可オリジン | * |
| `CLAUDE_SETTINGS_PATH` | 設定ファイルのパス | - |
| `REQUEST_TIMEOUT_MS` | リクエストタイムアウト(ms) | 300000 |
| `MAX_PROMPT_CHARS` | 最大プロンプト文字数 | 200000 |

### claude.settings.json

Claude Code CLIに渡す設定ファイルです：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  },
  "model": "sonnet"
}
```

- `env.ANTHROPIC_AUTH_TOKEN`: APIキー
- `env.ANTHROPIC_BASE_URL`: APIエンドポイント（変更することで他のプロバイダーも利用可能）
- `model`: 使用するモデル（sonnet/opus/haiku）

## 使用方法

LLM翻訳プラグインの設定で：

1. APIプロバイダーとして「Ollama」を選択
2. サーバーURLに `http://localhost:11434` を入力
3. モデルを選択して保存
