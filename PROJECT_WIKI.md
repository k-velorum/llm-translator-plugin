# LLM翻訳プラグイン Wiki

## 概要

Chrome Manifest V3 の翻訳拡張です。選択テキスト、ページ全体、X/Twitter、YouTube コメント、画像右クリック翻訳を、OpenRouter / Gemini / Cerebras / Z-AI / Ollama / LM Studio / Chrome Gemini Nano で実行します。

## アーキテクチャ

- `manifest.json`: service worker、popup、content script の読み込み順と権限を定義します。
- `background.js`: service worker entry。`src/background/event-listeners.js` と `src/background/message-handlers.js` を初期化します。
- `src/background/api/registry.js`: provider 定義の中心。settings key と capabilities を保持します。
- `src/background/api/providers/`: provider ごとの API 実装。OpenAI 互換 provider、ローカル provider、Chrome Prompt API を分離しています。
- `src/background/api.js`: registry から provider を選び、翻訳・streaming・画像翻訳を委譲する facade です。
- `src/background/message-handlers.js`: action table で background message を dispatch します。provider 操作は `verifyApiKey` / `getModels` に統一しています。
- `src/background/page-translation-service.js`: ページ翻訳セッション、進捗、continue/cancel を管理します。
- `src/background/selection-translation.js`: 選択翻訳と表示 fallback を管理します。
- `src/background/image-translation.js`: 画像右クリック翻訳を管理します。
- `src/offscreen/chrome-prompt-runtime.js`: Chrome Gemini Nano の offscreen runtime です。
- `src/popup/`: popup UI の ES Module 群です。`provider-ui.js` のテーブルから provider 設定セクションを生成します。
- `src/content/`: classic content scripts です。`namespace.js` と `messaging.js` を先頭に読み込み、DOM 操作と background 通信を担当します。

## Popup

`popup.html` は静的 provider セクションを持たず、`provider-section-template` と `src/popup/provider-ui.js` の `PROVIDER_UI` から同じ id/class の DOM を生成します。

主なファイル:

- `src/popup/main.js`: 初期化、要素取得、イベント結線。
- `src/popup/provider-ui.js`: provider 表示定義、DOM 生成、section 参照。
- `src/popup/models.js`: Select2 初期化、モデル取得、選択復元。
- `src/popup/settings-form.js`: 設定読み込み・保存。
- `src/popup/test-api.js`: popup の翻訳テスト。
- `src/popup/status.js`: ステータス表示。
- `src/popup/logs.js`: ページ翻訳ログ表示。

## Content Scripts

`manifest.json` の content script 読み込み順は次の通りです。

1. `src/content/namespace.js`
2. `src/content/messaging.js`
3. `src/content/shared.js`
4. `src/content/streaming.js`
5. `src/content/selection.js`
6. `src/content/page-translation.js`
7. `src/content/twitter.js`
8. `src/content/youtube.js`
9. `src/content/runtime.js`
10. `content.js`

content から background への送信は `safeSendMessage` / `sendBackgroundMessage` を使います。X/Twitter と YouTube の埋め込み翻訳 action は `translateEmbeddedText` です。

## Provider 追加

1. `src/background/api/providers/<provider>.js` を追加します。
2. `src/background/api/registry.js` に `settingsKeys` / `needsApiKey` / `capabilities` と一緒に登録します。
3. popup に表示する場合は `src/popup/provider-ui.js` に entry を追加します。
4. 必要なら `src/popup/provider-default-models.js` にデフォルトモデルを追加します。
5. request shape と registry のテストを更新します。

## 品質

- `bun run lint`
- `bun run test`

旧 provider 別 action alias と `translateTweet` alias は撤去済みです。互換目的で再導入する場合は、送信側が本当に必要かを grep で確認し、削除予定を docs に残してください。
