# ページ翻訳アルゴリズム レビュー指摘事項

日付: 2026-08-22
対象: `src/background/page-translation/{chunking,translator,runner}.js`、`page-translation-service.js`、`src/content/page-translation.js`、`src/shared/structured-batch.js`、provider 実装群。
レビュー時点の検証状況: `bun run test` 全緑（12 files / 59 tests）。

## 指摘サマリ

| # | 重要度 | 内容 | 主な場所 |
|---|--------|------|----------|
| 1 | 高 | partial セッションが SW 終了で失われ「失敗分を再試行」がほぼ機能しない | `src/background/page-translation-service.js:14` |
| 2 | 中 | 拡張自身の UI テキストがスナップショットに混入し、再実行時に翻訳対象になる | `src/content/page-translation.js:9` |
| 3 | 中 | structured の id 欠落が原文バックフィル+警告のみで「完了」表示・再試行不可になる | `src/shared/structured-batch.js:101`、`src/background/page-translation/translator.js:147` |
| 4 | 低 | モデル出力は全パスで trim され、チャンク境界 item の前後空白が失われ得る | 下記参照 |
| 5 | 低 | structured が失敗 1 回でセッション全体無効化される | `src/background/page-translation/translator.js:135` |
| 6 | 低 | `delayMs` はワーカー毎なので実効レートは concurrency 倍になる | `src/background/page-translation/runner.js:142` |

## 詳細

### 1. [高] partial セッションが SW 終了で失われる

- セッションはメモリ上の Map のみ（`pageTranslationSessions`、`page-translation-service.js:14`）。
- keep-alive は `running=true` の間のみ有効で、完了/中断時に解除される（同ファイル :22-33、:153）。MV3 service worker は idle 約 30 秒後に終了するため、partial（一部失敗）表示中に SW が切れるとセッションが消える。
- 結果: `continuePageTranslation`（失敗チャンク再試行）を実行できるのは partial 直後の数秒間のみで、実質機能しない。
- 修正案: セッション状態を `chrome.storage.session` に永続化するか、partial パネル表示中は keep-alive を維持する。

### 2. [中] 拡張自身の UI テキストが翻訳対象になる

- `capturePageTextSnapshot`（`src/content/page-translation.js:9`）は `DOMUtils.getTextNodes(document.body)` の全 text node を除外なしで取得する。
- 翻訳コントロール（id `llm-page-translation-controls`、同ファイル :92）や選択範囲ポップアップのテキストもスナップショットに含まれるため、再実行時にこれらが翻訳・上書きされる。
- 修正案: キャプチャ前に拡張自身の要素（id/class で特定）を除外する。

### 3. [中] structured の id 欠落が「完了」に集計される

- `normalizeStructuredBatchResult`（`src/shared/structured-batch.js:101`）は id 欠落率が 5 割未満なら欠落 item を原文で埋めて警告ログのみ（:134-149）。
- この経路では `tryStructured` が `failedItems: 0` を返す（`translator.js:147`）ため、UI は「完了」と表示し、該当 item の再試行ができない。
- 修正案: バックフィル件数を `failedItems` に集計するか、再試可能リストとして露出する。

### 4. [低] trim による前後空白の剥離（全パスで発生し得る）

- structured パス: item ごとの `.trim()`（`src/shared/structured-batch.js:126`）。
- per-item フォールバック: provider の `translate` が各結果を全体文字列として trim するため、item 単位でも前後空白が消える（`openai-compatible.js:79`、`ollama.js:49`、`lmstudio.js:57-60`、`gemini.js:59`）。
- セパレータ連結: provider が全体文字列のみ trim し `translator.js:199` で `.split(sep)` するため、チャンク先頭 item の先頭空白・末尾 item の末尾空白は消える（中間 item は sep 周囲の空白を保持し得る）。
- 適用側は `nodeValue` を直接置換する（`src/content/page-translation.js:48`）ため、インライン要素間の空白が潰れる可能性はある。
- ただしデフォルト日本語訳出では影響は小さい（CJK に語間スペースは不要）。顕在化しやすいのはカスタムプロンプトで英語圏言語に翻訳する場合や `<pre>`/等幅コンテンツの末尾改行消失など。

### 5. [低] structured が失敗 1 回でセッション全体無効化される

- `tryStructured` の catch（`translator.js:135`）は、タイムアウト含む 1 回の失敗で `runtime.structuredDisabled = true` をセットし、以降のチャンクでも structured を使わない（:148-172）。
- 一時的なタイムアウトがセッション全体に効くため、本来使える provider でもセパレータ方式に固定され得る。
- 修正案: 連続失敗回数で判定するか、再試行時に再有効化する。

### 6. [低] `delayMs` がワーカー毎である

- ワーカー各々が `delayMs` を待機するため（`runner.js:172-174`）、実効の API 間隔は `delayMs / concurrency` に近づく。
- レート制限を意図して設定している場合、想定より高速なリクエストになる点に注意。
- 修正案: ドキュメント化するか、全ワーカー共通のグローバル間隔にする。

## 検証して問題なしだった点

- chunking は structured モードでも入力は常に `maxChars` 以下（2.2 倍 multiplier は出力推定側の緩和）。
- キャンセル/AbortError の伝播、retry 時の pending リセット、oversized single item の all-or-nothing。
