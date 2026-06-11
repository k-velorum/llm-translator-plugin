# LLM翻訳プラグイン

選択したテキストやページ全体をLLMで翻訳するChrome拡張機能（Manifest V3）です。クラウドAPI・ローカルLLM・Chrome内蔵モデルの7プロバイダーに対応しています。

## 機能

- **選択テキストの翻訳**: 右クリックメニュー、またはショートカット（`Ctrl+Shift+T` / macOS `Cmd+Shift+T`）で翻訳し、ポップアップ表示
- **ページ全体翻訳**: 右クリックメニューから実行。チャンク分割で順次翻訳し、進捗表示と「続きを実行」に対応
- **画像内テキストの翻訳**: 画像上の右クリックメニューから実行（LM Studioのマルチモーダルモデルのみ対応）
- **Twitter(X) / YouTube 連携**: ツイートやYouTubeコメントに翻訳ボタンを表示（機能タブでON/OFF可能）
- **システムプロンプト編集**: 翻訳方針を決めるsystemプロンプトを変更可能（既定に戻すボタンあり）
- **テストタブ**: 短文で設定済みプロバイダーの疎通確認

## 対応プロバイダー

| プロバイダー | 種別 | APIキー取得先 / 備考 |
|---|---|---|
| OpenRouter | クラウド | [openrouter.ai](https://openrouter.ai/) |
| Google Gemini | クラウド | [Google AI Studio](https://aistudio.google.com/) |
| Cerebras | クラウド | [Cerebras Inference](https://inference-docs.cerebras.ai/introduction) |
| Z-AI | クラウド | Z-AI の API Keys ページ |
| Ollama | ローカル | [ollama.ai](https://ollama.ai/) を起動（既定: `http://localhost:11434`） |
| LM Studio | ローカル | [lmstudio.ai](https://lmstudio.ai/) を起動（既定: `http://localhost:1234`）。画像翻訳対応 |
| Chrome Gemini Nano | ブラウザ内蔵 | Chrome Built-in Prompt API を使用。APIキー・外部通信とも不要 |

ローカルプロバイダー（Ollama / LM Studio）と Chrome Gemini Nano では、翻訳データは外部に送信されません。

## インストール

1. このリポジトリをクローンまたはダウンロードします
2. Chromeで `chrome://extensions/` を開きます
3. 右上の「デベロッパーモード」をオンにします
4. 「パッケージ化されていない拡張機能を読み込む」からこのリポジトリのディレクトリを選択します

## 設定

1. ツールバーの拡張アイコンをクリックして設定画面を開きます
2. 使用するプロバイダーを選択し、APIキー（またはローカルサーバーのURL）とモデルを設定して保存します

機能タブでは以下を調整できます。

- Twitter(X) / YouTube 翻訳ボタンのON/OFF
- ページ全体翻訳のパラメータ（チャンク最大文字数 / 最大要素数 / 1パスあたりのチャンク数 / チャンク間ディレイ / 区切りトークン）
- 翻訳システムプロンプト

## 使い方

- **選択翻訳**: テキストを選択 → 右クリック「LLM翻訳」、またはショートカット。結果はポップアップに表示され、コピーできます
- **ページ全体翻訳**: ページ上で右クリック「LLMページ全体翻訳」
- **画像翻訳**: 画像上で右クリック「LLM画像翻訳」
- **Twitter(X)**: ツイート下部の「LLM翻訳」ボタンをクリックすると、ツイートの下に訳文を表示
- **YouTube**: コメント右側の「JP」ボタンをクリックすると、直下に訳文を表示

## トラブルシューティング

**Ollamaで403エラーが出る（CORS）**

環境変数 `OLLAMA_ORIGINS` を設定してサーバーを起動してください。

```bash
# macOS / Linux
OLLAMA_ORIGINS=* ollama serve

# Windows PowerShell
$env:OLLAMA_ORIGINS="*"; ollama serve
```

特定の拡張のみ許可する場合は `chrome-extension://<拡張ID>` を指定します。

## 既知の制限

- LLMの出力は安定しない場合があります（同じ入力でも表現がぶれることがあります）
- Chrome Gemini Nano は Prompt API 対応の Chrome とローカルモデルの利用条件を満たす環境でのみ動作します
- ページ翻訳の区切りトークンを変更する場合は、システムプロンプト内のトークンも合わせてください

## 開発

```bash
bun install
bun run lint   # ESLint
bun run test   # Vitest
```

- `background.js` / `src/background/`: service worker。provider実装は `src/background/api/providers/`、provider定義は `src/background/api/registry.js` に集約
- `src/content/`: content scripts（選択翻訳・ページ翻訳・Twitter/YouTube連携）
- `src/popup/`: 設定ポップアップ（ES Modules）
- `src/shared/`: エラー処理・ロガー・定数などの共通層

アーキテクチャの詳細は [PROJECT_WIKI.md](PROJECT_WIKI.md) を、開発規約は [CLAUDE.md](CLAUDE.md) を参照してください。

## プライバシー

- APIキーはブラウザのローカルストレージにのみ保存され、開発者には送信されません
- 翻訳対象のテキストは、選択したプロバイダーのAPIにのみ送信されます
- APIの利用料金はユーザー負担です

## ライセンス

MITライセンス
