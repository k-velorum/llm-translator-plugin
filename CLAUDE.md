# CLAUDE.md

このリポジトリは Chrome Manifest V3 の LLM 翻訳拡張です。実装変更時は既存の storage key、message action、ユーザー可視挙動を維持してください。

## 開発コマンド

- `bun run lint`: ESLint。現状 warning は残っていますが error 0 を品質ゲートにします。
- `bun run test`: Vitest。provider registry、settings、API request shape、エラー正規化などを固定します。
- `bun -e "JSON.parse(await Bun.file('manifest.json').text())"`: manifest JSON の軽量確認。

## 構造

- `background.js`: service worker entry。イベント登録と message dispatch を初期化します。
- `src/background/api.js`: provider registry を参照する薄い facade。provider 分岐をここへ戻さないでください。
- `src/background/api/registry.js`: provider 定義、settings key、capabilities の単一ソース。
- `src/background/api/providers/*.js`: provider 固有の translate / stream / structured batch / verify / getModels 実装。
- `src/background/api/http.js`: HTTP、SSE、retry、レスポンス抽出の共通層。
- `src/background/message-handlers.js`: runtime action table。provider 操作は `verifyApiKey { provider }` / `getModels { provider }` に統一済みです。
- `src/background/page-translation/`: ページ翻訳の処理本体。`chunking.js`（分割）、`translator.js`（チャンク翻訳。構造化 → セパレータ → 分割 → item 単位の段階フォールバックで、失敗 item は null=原文維持）、`runner.js`(worker pool で連続実行、失敗チャンクの記録と再試行)。3つともユニットテスト対象です。チャンク失敗でページ全体翻訳を止めない設計と、チャンク単位の時間予算（deadlineAt。フォールバック各段のタイムアウトを残り予算に丸める）を維持してください。ローカル provider の並列数は registry の `maxPageTranslationConcurrency` で制限しています。
- `src/shared/`: background / popup から使うエラー、logger、定数、batch 正規化。
- `src/popup/`: popup は ES Module。`main.js` は初期化とイベント結線だけにし、provider UI は `provider-ui.js` のテーブルから生成します。
- `src/content/`: classic content scripts。`namespace.js` / `messaging.js` を先頭に読み込み、content から background への送信は `safeSendMessage` / `sendBackgroundMessage` に寄せています。

## Provider 追加手順

1. `src/background/api/providers/<provider>.js` を追加し、最低限 `translate` と `translateBatchStructured` を実装します。streaming 対応なら `translateStream`、APIキー検証やモデル一覧が必要なら `verify` / `getModels` も同じ provider モジュールに置きます。
2. `src/background/api/registry.js` に provider を登録します。`settingsKeys` は既存 storage key と同じ命名規則にし、`capabilities.supportsStreaming` と `translateStream` の整合を崩さないでください。
3. popup 表示が必要なら `src/popup/provider-ui.js` に provider entry を追加します。既存設定との互換のため、`settingsKeys` の key 名は保存済み設定を読める値にします。
4. デフォルトモデルが必要なら `src/popup/provider-default-models.js` に追加します。
5. `test/provider-registry.test.js` と provider request shape のテストを追加または更新します。
6. `bun run lint && bun run test` を通します。

2026-06-12 のダミープロバイダー実証では、製品コードの修正箇所は provider 実装、registry、provider UI、default models の 4ファイルでした。証跡コミットは revert 済みです。

## Message Action 方針

- provider API キー検証: `verifyApiKey` + `provider`
- provider モデル取得: `getModels` + `provider`
- 埋め込みテキスト翻訳: `translateEmbeddedText`
- popup 翻訳テスト: `testTranslate`
- ページ全体翻訳の制御: `continuePageTranslation`（失敗チャンクの再試行）/ `cancelPageTranslation`。background は受理時点で即 sendResponse し、進捗・完了は `showPageTranslationControls` の push（`status: running|completed|partial`）で通知します。完了まで sendResponse を待たせる実装に戻さないでください。
- 旧 provider 別 action alias と旧 Twitter 専用 alias は撤去済みです。再追加しないでください。

## コメントと言語

- コメントと docs は日本語を基本にします。
- コメントは「何を」ではなく、制約・意図・互換理由などの Why を書きます。
- 機密情報や API key をログに出さないでください。ログは `src/shared/logger.js` を優先します。
