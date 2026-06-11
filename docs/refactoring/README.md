# リファクタリング全体計画

LLM 翻訳 Chrome 拡張（Manifest V3）の段階的リファクタリング計画。
2026-06-11 時点のコードベース調査（main: c8124c2）に基づく。

## 目的

長年の機能追加で蓄積した以下の負債を、**挙動を変えずに**解消する。

1. **プロバイダー分岐の散在** — 新プロバイダー追加に約 11 箇所の修正が必要
2. **巨大ファイル** — `src/background/api.js` (1263行) / `popup.js` (1173行) / `src/background/page-translation-service.js` (724行)
3. **コードの完全重複** — `api.js` と `src/offscreen/chrome-prompt-runtime.js` に同名・同内容の関数群が存在
4. **品質基盤の欠如** — package.json / リンタ / テストが一切ない
5. **ドキュメントの腐敗** — CLAUDE.md / PROJECT_WIKI.md が実装と乖離

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| [00-current-state.md](00-current-state.md) | 現状分析・問題点インベントリ・メトリクス |
| [01-phase1-hygiene.md](01-phase1-hygiene.md) | フェーズ1: プロジェクト衛生・開発基盤 |
| [02-phase2-shared-foundation.md](02-phase2-shared-foundation.md) | フェーズ2: 重複排除と共有基盤 |
| [03-phase3-provider-abstraction.md](03-phase3-provider-abstraction.md) | フェーズ3: プロバイダー抽象化（本丸） |
| [04-phase4-popup.md](04-phase4-popup.md) | フェーズ4: 設定 UI (popup) の再構築 |
| [05-phase5-content.md](05-phase5-content.md) | フェーズ5: content script 層の整理 |
| [06-phase6-quality.md](06-phase6-quality.md) | フェーズ6: テスト拡充・ドキュメント最終化 |
| [07-phase7-followup.md](07-phase7-followup.md) | フェーズ7: 追加実装計画（レビューで確認された残課題の解消） |
| [99-verification-checklist.md](99-verification-checklist.md) | 全フェーズ共通の手動スモークテスト手順 |

## フェーズ概要と依存関係

```
フェーズ1 (衛生・基盤)
   │  lint/test 基盤がフェーズ2以降の安全網になる
   ▼
フェーズ2 (重複排除・共有基盤)
   │  settings 一元化と offscreen 重複解消が
   │  フェーズ3 の分割の前提になる
   ▼
フェーズ3 (プロバイダー抽象化)        ← 最大の山場
   │  provider registry と汎用メッセージ API が
   ├──────────────┐  フェーズ4・5 の前提になる
   ▼              ▼
フェーズ4 (popup)   フェーズ5 (content)   ← 相互独立。並行可
   └──────┬───────┘
          ▼
フェーズ6 (テスト・ドキュメント)
```

| フェーズ | 規模感 | リスク | 主な成果 |
|---|---|---|---|
| 1 | 小 | 低 | package.json / ESLint / Vitest / 不要ファイル削除 / ドキュメント整合 |
| 2 | 中 | 低〜中 | offscreen 重複の完全解消、定数・ユーティリティ・ログの一元化 |
| 3 | 大 | 中〜高 | api.js のプロバイダー別分割、provider registry、メッセージ汎用化 |
| 4 | 中 | 中 | popup.js のモジュール分割、HTML テンプレート化、分岐の registry 駆動化 |
| 5 | 中 | 中 | グローバル汚染の封じ込め、UI ユーティリティ統合、リスナー管理 |
| 6 | 中 | 低 | ユニットテスト拡充、CLAUDE.md / PROJECT_WIKI.md 全面更新 |

## 全フェーズ共通の原則

### 不変条件（壊してはならないもの）

- **`chrome.storage.sync` のキー名と値の形式**。ユーザーの既存設定（API キー、モデル選択、プロンプト）はリファクタリング後もそのまま読めること。キー変更が必要な場合は必ずマイグレーションを書く。
- **ユーザーから見える挙動**。翻訳結果・UI・ショートカット・コンテキストメニューは一切変えない。挙動変更は本計画のスコープ外とし、見つけたバグは別チケット/別コミットで扱う。
- **manifest.json の権限**。削減はフェーズ1の検討事項としてのみ扱い、機能リファクタと混ぜない。

### 技術方針（調査により確定した制約）

- **background**: ES Modules（既存どおり）。
- **offscreen**: `offscreen.html` は `<script type="module">` で読み込んでいるため、**background のモジュールを直接 import できる**。重複コードの解消はこの方式で行う（ビルド不要）。
- **popup**: 現状 classic script。`<script type="module">` に変更すれば `src/background/settings.js` 等を import 可能。jQuery/Select2 は classic script のままグローバルとして参照できるため共存可。
- **content scripts**: Manifest V3 の `content_scripts` は ES Modules を直接サポートしない。**ビルドステップは導入しない**方針とし、IIFE + 名前空間オブジェクトでグローバル汚染を封じ込める（詳細はフェーズ5）。
  - 将来ビルド導入（esbuild 等）を選ぶ場合の判断材料もフェーズ5に記載。

### 進め方

- 1 コミット = 1 目的（プロジェクト規約どおり）。各フェーズ文書に推奨コミット分割を記載。
- 各タスク完了ごとに [99-verification-checklist.md](99-verification-checklist.md) の該当項目でスモークテストする。
- 純粋関数（JSON パース、バッチ正規化、設定マイグレーション等）は**移動する前に**特性テスト（characterization test）を書き、移動後に同じテストが通ることを確認する。
- フェーズをまたぐ作業はしない。各フェーズの「完了条件」をすべて満たしてから次へ進む。

## スコープ外

- TypeScript への移行（フェーズ6完了後に別途検討。JSDoc 型注釈までを本計画に含む）
- 新機能追加・挙動変更・パフォーマンス改善
- jQuery/Select2 の置き換え自体（フェーズ4で**判断材料の整理**までを行い、実施は任意の追加タスクとする）
- Firefox 等の他ブラウザ対応

## 実施結果（2026-06-12）

- フェーズ1〜6のコードリファクタリングは完了。push は未実施。
- provider 追加時の主な修正箇所は `src/background/api/providers/<provider>.js`、`src/background/api/registry.js`、`src/popup/provider-ui.js`、必要に応じて `src/popup/provider-default-models.js` とテスト。
- 最大ファイルは `src/content/twitter.js` 425行。`src/background/message-handlers.js` は 435行から 242行へ、
  `src/background/page-translation-service.js` は 635行から 305行へ縮小。
- 自動検証: `bun run lint` は error 0（warning 29）、`bun run test` は 10 files / 45 tests pass、`manifest.json` parse OK。
- 通常 Chrome の既存プロファイルで、LM Studio 設定復元・popup Test・選択翻訳（main frame / iframe）・
  ページ翻訳・X / YouTube のボタン注入と翻訳・Feature OFF/ON を確認済み。
- フェーズ7で verify/getModels を provider モジュールへ移設し、追加の handlers/ 分割は不要と判断。
- ダミープロバイダー実証により、provider 追加時の製品コード修正箇所は 4ファイル
  （provider 実装、registry、provider UI、default models）と確認。実証コミットは revert 済み。
- フルプロバイダーマトリクス、画像翻訳、ショートカット、20回開閉 listener 確認、既存プロファイル上書きロードは未確認として記録済み。
