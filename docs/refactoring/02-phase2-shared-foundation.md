# フェーズ2: 重複排除と共有基盤

対象問題: B-1〜B-7、F-1、C-7（[00-current-state.md](00-current-state.md)）

## 目的

フェーズ3で api.js を分割する前に、**同じコードが2箇所にある状態**と
**同じ概念が複数の表現を持つ状態**（定数・エラー・ログ・sleep）を解消する。
ここで作る共有モジュールがフェーズ3以降の置き場所の土台になる。

## 前提

- フェーズ1完了（特性テストが green であること。本フェーズの作業は全てそのテストの保護下で行う）

## 新設するディレクトリ

```
src/shared/            # background / offscreen / (popup) から import される ESM
  ├─ structured-batch.js   # スキーマ・指示文・パース・正規化
  ├─ errors.js             # エラー正規化・直列化
  ├─ logger.js             # ログファサード（logging.js を取り込む）
  ├─ constants.js          # タイムアウト等の横断定数
  └─ async-utils.js        # sleep / sleepWithSignal / withTimeout
```

content scripts は classic script のため import できない。content 用の共有はフェーズ5で扱う
（このフェーズでは触らない）。

## タスク

### 2-1. 構造化バッチ処理の一元化（B-1）— 本フェーズの本丸

1. `src/shared/structured-batch.js` を新設し、api.js 側の実装を移す:
   - `STRUCTURED_BATCH_SCHEMA`
   - `buildStructuredBatchInstruction`
   - `parseJsonLoose`
   - `normalizeStructuredBatchResult`
2. `src/background/api.js` から該当定義を削除し import に置換。
3. `src/offscreen/chrome-prompt-runtime.js` から該当定義を削除し import に置換
   （offscreen.html は `type="module"` のため可能。相対パス `../shared/structured-batch.js`）。
4. **移行前に両実装を diff し、差異があれば挙動差を特性テストに起こしてから統合する**。
   調査では「ほぼ同一だがプロンプト合成部に若干の差異」とされているため、差異が意図的
   （offscreen 固有の事情）なら引数で吸収し、事故由来（片側だけ修正された）なら新しい方に揃える。
5. フェーズ1の特性テストの import 先を `src/shared/structured-batch.js` に変更し、green を確認。

検証: Chrome Gemini Nano プロバイダーでのページ翻訳・選択翻訳（offscreen 経路）と、
他プロバイダーでのバッチ翻訳（background 経路）の両方をスモークテスト。

### 2-2. 設定・定数の単一ソース化（B-2, B-3, B-7）

1. `src/background/settings.js` を設定の単一ソースと位置付ける:
   - `page-translation-service.js:10-22` のページ翻訳系定数のうち、DEFAULT_SETTINGS と重複する
     ものを削除し settings.js から import。重複でない純粋な内部定数はそのまま残す。
   - `image-translation.js` のタイムアウト等は `src/shared/constants.js` へ。
2. タイムアウト 180000ms / 120000ms 等の散在値を `src/shared/constants.js` に名前付きで集約
   （`TRANSLATION_TIMEOUT_MS` など）。**値は変えない**。content 側（page-translation.js の 200000ms）は
   import できないためフェーズ5で対応する旨をコメントで残す。
3. popup.js のデフォルトプロンプト二重定義（B-2）はフェーズ4の popup モジュール化とセットで解消
   するため、ここでは触らない（本文書では位置付けのみ明記）。

### 2-3. エラー正規化の統一（B-5, F-1）

1. `src/shared/errors.js` を新設:
   - `normalizeError(error, context)` — どんな入力（Error / 文字列 / API レスポンス）からも
     `{ message, details, status?, provider? }` 形式を返す唯一の関数。
   - `serializeError`（offscreen 用）と `normalizeStreamError`（streaming 用）は
     normalizeError の薄いラッパとして再実装するか、呼び出し側を直接置換。
2. `formatErrorDetails`（api.js）はプロバイダー固有のメッセージ整形を含むため、
   フェーズ3でプロバイダー定義側へ分解する。このフェーズでは**出力形式だけ** normalizeError と
   揃えておく（プロパティ名の統一）。
3. message-handlers.js の `{ message: error.message, details: error.stack }` 直組み箇所を
   normalizeError 呼び出しに置換。
4. sendResponse 様式の統一（F-1）: 「全ハンドラは `{ ...payload }` または `{ error: normalizeError(...) }`
   を返し、非同期なら `return true`」という規約を決めてコメントで明文化し、揺れている箇所を修正。
   応答を受ける content / popup 側の判定が壊れないよう、**既存のプロパティ名（`error`, `result`,
   `models` 等）は維持**する。

### 2-4. ログファサード導入（B-6）

1. `src/shared/logger.js` を新設。`logging.js` の `appendLog` 蓄積機構はページ翻訳ログ表示で
   使われているため**維持**し、その上にファサードを被せる:
   - `log.debug/info/warn/error(scope, message, meta?)`
   - 内部で console 出力 + （ページ翻訳系の scope なら）appendLog への転送。
   - meta の **API キーらしきフィールドを自動マスク**（`apiKey`, `Authorization` 等のキー名で
     伏字化）。background.js の `sanitizeMessageForLog` をここへ移し全ログ経路に適用する。
2. background / offscreen の `console.*` 直書き（約40〜50箇所）を log.* に機械的に置換。
   このとき**出力レベルを勝手に変えない**（console.log → log.info 等の対応表を決めて一括置換）。
3. content / popup の console はフェーズ4・5で対応（import 不可のため）。
4. `logging.js getProviderMeta` のプロバイダー分岐はフェーズ3で registry に吸収する旨をコメント。

### 2-5. 小物の統一と死んだコードの除去（B-4, C-6, C-7）

1. `src/shared/async-utils.js` に `sleep` / `sleepWithSignal` を集約し、二重定義を削除。
2. `OPENROUTER_HEADERS_BASE` を OpenRouter モデル取得でも参照させる（C-6）。
3. 「Anthropic は削除済み」等の歴史コメントを削除（C-7）。
4. `formatErrorDetails` の else-if 連鎖に default 節を追加（到達不能分岐の明示化）。

## 完了条件

- [ ] `parseJsonLoose` 等4関数の定義がリポジトリ内に**ちょうど1つ**である（grep で確認）
- [ ] フェーズ1の特性テストが import 先変更後も全て green
- [ ] `sleep` 系の定義が1箇所、エラー正規化の入口が `normalizeError` に統一されている
- [ ] background / offscreen に `console.*` 直書きが残っていない（logger 経由）
- [ ] API キーがログに平文で出る経路がない（logger のマスクテストを追加）
- [ ] スモークテスト全項目 PASS。特に **Chrome Gemini Nano 経路**と**ストリーミング翻訳**

## リスクと対策

| リスク | 対策 |
|---|---|
| offscreen の import パス解決ミス（拡張内相対パス） | offscreen.html から `../shared/` が解決できることを最初に最小変更で確認してから本移行 |
| 両実装の「微妙な差異」を潰して挙動が変わる | 統合前に必ず diff + 差異の特性テスト化（タスク 2-1-4） |
| console 一括置換でレベルやメッセージが変質 | 置換対応表を決めてから機械的に実施。1コミットに分離しレビュー可能にする |
| sendResponse 形式変更で popup/content が応答を読めなくなる | 応答プロパティ名は変えない。各 action ごとにスモーク確認 |

## 推奨コミット分割

1. `refactor(shared): 構造化バッチ処理を src/shared に一元化`（テスト移行込み）
2. `refactor(shared): 定数とsleep系ユーティリティを集約`
3. `refactor(shared): エラー正規化を normalizeError に統一`
4. `refactor(shared): ログファサードを導入しAPIキーマスクを全経路に適用`
5. `chore: 死んだコメントと未参照定数を削除`
