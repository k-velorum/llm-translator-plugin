# フェーズ4: 設定 UI (popup) の再構築

対象問題: D-1〜D-6、B-2 残件（[00-current-state.md](00-current-state.md)）

## 目的

popup.js (1173行) の「プロバイダーごとの if/else コピペ」を、フェーズ3で作った
provider registry に対応する **UI 側プロバイダー設定テーブル**駆動に変える。
popup を ES Module 化して background 側の定義（settings.js、将来的に registry の表示情報）を
直接 import し、二重定義を消す。

## 前提

- フェーズ3完了（汎用 `verifyApiKey` / `getModels` アクションが存在すること）
- フェーズ5とは独立。並行作業可

## 目標構造

```
popup.html               # <script type="module" src="src/popup/main.js"> に変更
src/popup/
  ├─ main.js             # 初期化・イベント結線のみ
  ├─ provider-ui.js      # PROVIDER_UI テーブル + セクション動的生成/制御
  ├─ settings-form.js    # loadSettings / saveSettings / レガシー移行表示
  ├─ models.js           # モデル一覧取得・Select2 初期化・モデル情報表示
  ├─ test-api.js         # 翻訳テスト実行
  └─ status.js           # ステータス/エラー表示の唯一の窓口
```

jQuery / Select2 は classic script のまま先に読み込まれ、module からグローバル `$` を参照する
（動作確認済みの一般的な構成。ESLint には popup 環境のグローバルとして登録済み＝フェーズ1）。

## タスク

### 4-1. ES Module 化と定数の単一ソース化（B-2, D-6）

1. `popup.js` を `src/popup/main.js` へ移動し、`popup.html` の script タグを
   `type="module"` に変更。**この時点では中身は無修正**（移動のみ）。全機能スモーク。
2. `DEFAULT_TRANSLATION_SYSTEM_PROMPT` / `DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT` の
   ローカル定義を削除し、`src/background/settings.js` から import（D-6 のレガシー移行判定も
   settings.js の関数を呼ぶ形に一本化）。

### 4-2. UI 側プロバイダーテーブルの導入（D-1, D-3）

1. `provider-ui.js` に表示・フォーム情報のテーブルを定義:

```js
const PROVIDER_UI = {
  openrouter: {
    label: 'OpenRouter',
    needsApiKey: true,
    elements: { apiKey: 'openrouterApiKey', model: 'openrouterModel', ... },  // 既存の DOM id
    modelSelect: { type: 'select2', infoFormatter: formatOpenRouterModelInfo },  // 価格表示
    extraFields: [],            // ollama/lmstudio はサーバURL欄など
  },
  ...
}
```

2. 巨大関数をテーブル駆動ループに書き換える:
   - `loadProviderModels`（82行・6分岐）→ 全プロバイダー共通フロー + テーブルの差分情報。
     メッセージは汎用 `getModels { provider }` を使用（フェーズ3の成果）。
   - `testApi`（133行・7分岐）→ 「テーブルから検証ルールと providerSettings を構築 → 共通送信」
     の 50 行以下に圧縮。
   - `loadSettings` / `saveSettings` のプロバイダー項目をテーブル走査に置換。
     **storage キー名は PROVIDER_UI に書かれた既存名をそのまま使う**（互換性の生命線）。
   - `updateModelInfo` / `validateApiKey` の分岐をテーブルの `infoFormatter` / `needsApiKey` へ。
3. provider 別の旧 action 呼び出しが popup から消えたことを grep で確認
   （フェーズ6の alias 削除の前提になる）。

### 4-3. popup.html のテンプレート化（D-2）

1. プロバイダー設定セクション（×6、約120行）を `<template id="provider-section-template">`
   1つに統合し、`provider-ui.js` が PROVIDER_UI から各セクションを生成・差し込む。
2. id ベースの既存コード（`getElements` の 49 個の getElementById）はセクション生成時に
   要素参照を直接返す方式へ変え、`getElements` を縮小する。
3. 生成後の DOM が旧 HTML と同じ id / class を持つことを確認（CSS と Select2 が依存するため）。

### 4-4. 表示まわりの統一（D-4 + console 整理）

1. `status.js` に `showStatus(kind, message)` を一本化。`verifyApiKey` の `style.color`
   直接代入＋色ハードコードを廃止し、CSS クラス（既存の success/error + CSS 変数）に統一。
2. popup 内の `console.*`（約15箇所）を整理。module 化により `src/shared/logger.js` を
   import できるため logger 経由に統一。

### 4-5. jQuery / Select2 の扱い（D-5）— 判断材料の整理のみ

本計画では**置き換えを実施しない**。理由と将来判断のための材料を残す:

- 利用実態: jQuery は Select2 の前提としてのみ必要（`$()` 直接利用は約16箇所、全て Select2 関連 or 置換容易）。
- 置換候補: ネイティブ `<select>` + `<datalist>` / Slim Select 等の脱 jQuery ライブラリ。
- 効果: 配布物 約100KB 減、依存削減。リスク: モデル検索 UX（数百モデルの絞り込み表示）の再現コスト。
- 4-2/4-3 の完了により Select2 への接点は `models.js` の1箇所に集約されるため、
  将来の置き換えは popup 全体に波及しない。**この集約までが本計画の責務**。

## 完了条件

- [ ] `src/popup/` 配下に分割され、1ファイル 300 行以下
- [ ] popup にプロバイダー名による if/else 連鎖が残っていない（PROVIDER_UI 走査のみ）
- [ ] 旧 verify/getModels 系 action の呼び出しが popup に存在しない
- [ ] 既存ユーザー設定（全プロバイダーの API キー・モデル選択・カスタムプロンプト）が
      リファクタリング前に保存した状態のまま読み込めることを実機確認
- [ ] スモークテスト: 全プロバイダーで「キー入力 → 検証 → モデル一覧 → 選択 → 保存 →
      再オープンで復元 → 翻訳テスト」が PASS

## リスクと対策

| リスク | 対策 |
|---|---|
| module 化のタイミングで Select2 初期化順が崩れる（module は defer 実行） | 4-1 を独立コミットにし、移動直後に全機能スモーク。`DOMContentLoaded` 依存を確認 |
| テンプレート生成で id 重複・CSS ずれ | 生成後 DOM のスナップショット比較（旧 HTML と diff）を目視で実施 |
| storage キー名の打ち間違いで設定消失に見える | PROVIDER_UI のキー名を旧コードから機械的にコピーし、保存・復元のラウンドトリップを全プロバイダーで確認 |

## 推奨コミット分割

1. `refactor(popup): ES Module 化しファイルを src/popup へ移動`
2. `refactor(popup): デフォルトプロンプト定義を settings.js に一本化`
3. `refactor(popup): PROVIDER_UI テーブルを導入し loadProviderModels/testApi を駆動化`
4. `refactor(popup): 設定セクションをテンプレート生成に統合`
5. `refactor(popup): ステータス表示とログを統一`

## 実績（2026-06-12）

- popup は ES Module 化し、`src/popup/main.js` は 164行、popup 配下の最大は `provider-ui.js` 291行。
- provider 設定セクションは `popup.html` のテンプレートと `src/popup/provider-ui.js` の定義から生成する構成へ移行。
- provider API キー検証 / モデル取得は汎用 action に統一済み。
- 自動検証は `bun run lint` error 0、`bun run test` 37 tests pass。
- 全プロバイダーの実 API 疎通と既存プロファイル復元は実機 Chrome 確認が必要なため未実施。
