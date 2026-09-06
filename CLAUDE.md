# CLAUDE.md

このリポジトリは Chrome Manifest V3 の LLM 翻訳拡張です。実装変更時は既存の storage key、message action、ユーザー可視挙動を維持してください。

## 開発コマンド

- `bun run lint`: ESLint。現状 warning は残っていますが error 0 を品質ゲートにします。
- `bun run test`: Vitest。provider registry、settings、API request shape、エラー正規化などを固定します。
- `bun -e "JSON.parse(await Bun.file('manifest.json').text())"`: manifest JSON の軽量確認。

## 構造

- `background.js`: service worker entry。イベント登録と message dispatch を初期化します。
- `src/background/api.js`: provider registry を参照する薄い facade。provider 分岐をここへ戻さないでください。
- `src/shared/connections.js`: OpenAI互換APIのプリセット、接続設定の移行、URL検証、capabilities。
- `src/background/api/registry.js`: 接続方式（OpenAI互換 / Gemini / Chrome内蔵）を登録。旧provider名は保存済みセッションとの互換入口。
- `src/background/api/providers/openai.js`: OpenAI互換の共通API。旧互換providerファイルは薄いアダプター。LM Studio画像翻訳だけ `lmstudio-image.js` に分離。
- `src/background/api/providers/*.js`: Gemini / Chrome内蔵など固有プロトコルの実装。
- `src/background/api/http.js`: HTTP、SSE、retry、レスポンス抽出の共通層。
- `src/background/message-handlers.js`: runtime action table。provider 操作は `verifyApiKey { provider }` / `getModels { provider }` に統一済みです。
- `src/background/page-translation/`: ページ翻訳の処理本体。`chunking.js`（分割）、`translator.js`（チャンク翻訳。構造化 → セパレータ → 分割 → item 単位の段階フォールバックで、失敗 item は null=原文維持）、`runner.js`(worker pool で連続実行、失敗チャンクの記録と再試行)。3つともユニットテスト対象です。チャンク失敗でページ全体翻訳を止めない設計と、チャンク単位の時間予算（deadlineAt。フォールバック各段のタイムアウトを残り予算に丸める）を維持してください。ローカル provider の並列数は registry の `maxPageTranslationConcurrency` で制限しています。
- `src/shared/`: background / popup から使うエラー、logger、定数、batch 正規化。
- `src/popup/`: popup は ES Module。`main.js` は初期化とイベント結線。`provider-ui.js` は接続方式の表示、`connection-form.js` はプリセットごとの下書き・モデル取得・URL変更時のキー消去を担当。
- `src/content/`: classic content scripts。`namespace.js` / `messaging.js` を先頭に読み込み、content から background への送信は `safeSendMessage` / `sendBackgroundMessage` に寄せています。

## 接続先の追加

OpenAI互換APIはカスタム接続のURL・モデル設定だけで利用できます。プリセットとして追加する場合は `src/shared/connections.js` に既定URLと必要なAPI差分を定義し、必要なら `src/shared/default-models.js` にモデル例を追加します。新しいproviderモジュールや設定画面の分岐は作りません。

設定は `apiProvider: 'openai'`、`openaiPreset`、`openaiConnections`（プリセットごとのURL・キー・モデル・推論・ストリーム設定）で保持します。読み込み時に旧キーから移行し、新しい保存値の空欄を旧キーで埋め戻さないでください。非選択の接続先の設定も維持します。

異なるプロトコルの接続方式を追加するときだけ `registry.js` と `provider-ui.js` に登録します。変更後は `bun run lint && bun run test` と実際の設定画面で移行・切り替え・保存前の翻訳を確認してください。

## Message Action 方針

- provider API キー検証: `verifyApiKey` + `provider`
- contentの対応機能取得: `getTranslationCapabilities`。キー・URLなどの接続情報は返しません。
- provider モデル取得: `getModels` + `provider`
- 埋め込みテキスト翻訳: `translateEmbeddedText`
- popup 翻訳テスト: `testTranslate`
- ページ全体翻訳の制御: `continuePageTranslation`（失敗チャンクの再試行）/ `cancelPageTranslation`。background は受理時点で即 sendResponse し、進捗・完了は `showPageTranslationControls` の push（`status: running|completed|partial`）で通知します。完了まで sendResponse を待たせる実装に戻さないでください。
- 旧 provider 別 action alias と旧 Twitter 専用 alias は撤去済みです。再追加しないでください。

## コメントと言語

- コメントと docs は日本語を基本にします。
- コメントは「何を」ではなく、制約・意図・互換理由などの Why を書きます。
- 機密情報や API key をログに出さないでください。ログは `src/shared/logger.js` を優先します。
