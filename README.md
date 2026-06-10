# LLM翻訳プラグイン

Google Chrome用の拡張機能で、選択したテキストをLLM（大規模言語モデル）を使用して翻訳します。OpenRouter、Google Gemini API、Cerebras API、Z-AI、Ollama、LM Studio、Chrome Gemini Nanoを利用して翻訳機能を提供します。

## 機能

主要機能
- 選択テキストの翻訳: 右クリックメニューまたはショートカットで即翻訳
- 画像内テキストの翻訳: 画像上の右クリックメニューから実行
- ページ全体翻訳: コンテキストメニューから実行、進捗/続行UI付き
- プラットフォーム連携: Twitter(X) ツイート、YouTube コメントの翻訳ボタン

追加機能
- 複数プロバイダー対応: OpenRouter / Google Gemini / Cerebras / Z-AI / Ollama / LM Studio / Chrome Gemini Nano
- 詳細設定: ページ翻訳のチャンク/ディレイ/区切りトークンを調整
- システムプロンプト編集: 翻訳方針を機能タブから変更
- テストタブ: 短文で疎通確認
- キーボードショートカット: 既定は Windows/Linux `Ctrl+Shift+T`, macOS `Cmd+Shift+T`

## インストール方法

### 開発版として読み込む場合

1. このリポジトリをダウンロードまたはクローンします
2. Chromeを開き、`chrome://extensions/`にアクセスします
3. 右上の「デベロッパーモード」をオンにします
4. 「パッケージ化されていない拡張機能を読み込む」ボタンをクリックします
5. このリポジトリのディレクトリを選択します
6. 拡張機能が正常に読み込まれ、Chromeツールバーに表示されます

補足（アイコン）
- 必要なPNGアイコン（16/48/128px）は本リポジトリに同梱済みです。通常は作業不要です。
- アイコンを変更する場合のみ、`icons/README.md` を参照して生成してください。

## 設定

### API設定

1. 拡張アイコンをクリックして設定を開きます
2. 使用するAPIプロバイダー（OpenRouter / Google Gemini / Cerebras / Z-AI / Ollama / LM Studio / Chrome Gemini Nano）を選択
3. プロバイダーごとの設定を入力:
   - OpenRouter: [OpenRouter](https://openrouter.ai/) でAPIキー取得
   - Google Gemini: [Google AI Studio](https://aistudio.google.com/) でAPIキー取得
   - Cerebras: [Cerebras Inference](https://inference-docs.cerebras.ai/introduction) を参照してAPIキーを取得
   - Z-AI: Z-AI の API Keys ページでAPIキー取得
   - Ollama: [Ollama](https://ollama.ai/) をインストール・起動（既定: http://localhost:11434）
   - LM Studio: [LM Studio](https://lmstudio.ai/) をインストール・起動（既定: http://localhost:1234）
   - Chrome Gemini Nano: Chrome Built-in Prompt API を使用。APIキーと外部HTTP通信は不要
4. 必要なプロバイダーではモデルを選択して「設定を保存」

### 機能設定（機能タブ）

- プラットフォーム連携: Twitter(X)/YouTube の翻訳ボタンをON/OFF
- ページ全体翻訳の詳細設定:
  - チャンク最大文字数 / チャンク最大要素数
  - 1パスあたりのチャンク数 / チャンク間ディレイ(ms)
  - 区切りトークン（高度な設定。既定は `[[[SEP]]]`）
- 翻訳システムプロンプトの編集:
  - すべての翻訳API呼び出しで使用されるsystemプロンプトを編集可能
  - 既定文面に戻すボタンあり

## 使用方法

### 基本操作（選択翻訳）

1. ウェブページ上で翻訳したいテキストを選択します
2. 選択したテキスト上で右クリックし、メニューから「LLM翻訳」を選択します
3. 翻訳結果がポップアップで表示されます
4. 必要に応じて「コピー」ボタンをクリックして結果をクリップボードにコピーできます

### 画像翻訳

1. 画像上で右クリックし、コンテキストメニューから「LLM画像翻訳」を選択します
2. 拡張機能が画像を取得できた場合、画像内のテキストを翻訳してポップアップ表示します
3. 2026-03-13 時点の初期実装では、画像翻訳は LM Studio のマルチモーダル対応モデルを選択している場合のみ動作します

### ページ全体翻訳

1. ページ上で右クリックし、コンテキストメニューから「LLMページ全体翻訳」を選択します
2. 小チャンクに分割して順次翻訳・反映されます（進捗と「続きを実行」ボタン付き）
3. 詳細パラメータ（最大文字数/要素数/パス内チャンク数/遅延/区切りトークン）は機能タブで調整可能です

### Twitter(X)での翻訳

1. Twitter(X)のツイートの下部に「LLM翻訳」ボタンが表示されます
2. ボタンをクリックすると、ツイートが翻訳されます
3. 翻訳結果はツイートの下に表示されます

### YouTubeでの翻訳

1. コメント本文の右側に「JP」アイコンの翻訳ボタンが表示されます（機能タブでON/OFF）
2. クリックすると直下に翻訳結果が表示されます（長文は自動で縦に伸長）

### キーボードショートカット

- 選択テキストを翻訳: `Ctrl+Shift+T`（macOSは `Cmd+Shift+T`）

### テストタブによる疎通確認

1. ポップアップの「テスト」タブを開きます
2. APIを選択し、短い英語文を入力して「APIをテスト」をクリック
3. 設定済みのプロバイダー/モデルで翻訳が実行され、結果が表示されます

## プライバシーとセキュリティ

- APIキーはお使いのブラウザのローカルストレージにのみ保存され、開発者には送信されません
- 選択したテキストは翻訳のためにのみAPIに送信され、他の目的では使用されません
- すべての通信はHTTPS経由で安全に行われます
- ローカルLLM（Ollama、LM Studio）を使用する場合、データは外部に送信されません

## 開発者向け情報

- Manifest V3に準拠したChrome拡張機能
- OpenRouter API、Google Gemini API、Cerebras API、Z-AI、Ollama、LM Studio、Chrome Built-in Prompt APIに対応
- ES Modules対応のバックグラウンドスクリプト
- バックグラウンド処理は責務別に分割（`event-listeners.js` / `page-translation-service.js` / `selection-translation.js` / `message-handlers.js` / `api.js` / `settings.js`）
- jQuery 3.7.1 + Select2 4.0.13を使用したUI

## 既知の制限/注意点

- LLMの出力は安定しない場合があります（同じ入力でも表現がぶれることがあります）
- Chrome Gemini Nano は Prompt API 対応 Chrome とローカルモデルの利用条件を満たす環境でのみ動作します
- 区切りトークンを変更する場合は、プロンプト文面も同じトークンに合わせてください

## トラブルシューティング

- Ollama（ローカル）で403が出る/CORSに起因する問題:
  - 環境変数 `OLLAMA_ORIGINS` を設定してサーバーを起動してください
  - 例（macOS/Linux）: `OLLAMA_ORIGINS=* ollama serve`
  - 例（Windows PowerShell）: `$env:OLLAMA_ORIGINS="*"; ollama serve`
  - 特定の拡張IDのみ許可する場合は `chrome-extension://<拡張ID>` を指定

## 免責事項

- この拡張機能はデモンストレーション目的で作成されています
- 翻訳の品質はLLMの性能に依存します
- APIの使用に関連する費用はユーザー負担となります

## ライセンス

MITライセンス
