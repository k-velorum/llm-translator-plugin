# フェーズ6: テスト拡充・互換レイヤ撤去・ドキュメント最終化

対象問題: A-1 残件、C-3 残件、F-3、全フェーズの後始末

## 目的

リファクタリング後の構造を**回帰から守る資産**（テスト・ドキュメント・lint ルール）として固定し、
移行期間のために残した互換コードを撤去して完了とする。

## 前提

- フェーズ4・5の両方が完了していること

## タスク

### 6-1. 互換レイヤの撤去

1. background の旧 action alias を削除:
   - provider 別の API キー検証 / モデル取得 action 群（フェーズ3で alias 化、フェーズ4で送信側を撤去済み）
   - 旧 Twitter 専用 action（フェーズ5で送信側を `translateEmbeddedText` へ移行済み）
2. 削除前に旧 action 名をリポジトリ全体で grep し、参照ゼロを確認。

### 6-2. ユニットテストの拡充

フェーズ1の特性テスト + フェーズ3のテストに加え、新構造の「境界」を固定する:

| 対象 | テスト内容 |
|---|---|
| `api/registry.js` | 全プロバイダー定義が必須フィールド・capabilities 整合（streaming 宣言に translateStream 実装が伴う等）を満たすことの検証テスト |
| `api/openai-compatible.js` | プロバイダー差分設定 → リクエスト URL/ヘッダ/ボディの組み立て結果を固定（実 HTTP 不要。Ollama/LM Studio の実機がなくても回帰検知できる層） |
| `settings.js` | DEFAULT_SETTINGS スナップショット、レガシー移行、未知キー混入時の挙動 |
| `page-translation/chunking.js` | 境界ケース（フェーズ3で作成済みなら拡充） |
| `src/shared/errors.js` / `logger.js` | 正規化の網羅、API キーマスク |
| `handlers/index.js` | action テーブルの dispatch（chrome.runtime をモックして verify/getModels の委譲を確認） |

目安: カバレッジ計測を有効化し、`src/shared/` と `src/background/api/` は line 80% 以上。
UI 層（popup/content）の DOM テストは費用対効果が低いため**スモークチェックリストで代替**し、
無理に自動化しない。

### 6-3. lint ルールの引き上げ

1. フェーズ1で warning に落とした・グローバル列挙で許容したルールを再評価し、
   現コードが満たせるものを error に引き上げる。
2. `complexity` / `max-lines-per-function` を緩い閾値（例: 15 / 80）で warning 導入し、
   再肥大化の検知線を張る。

### 6-4. ドキュメント最終化（F-3 含む）

1. `CLAUDE.md` を新構造で全面更新:
   - Code Structure（api/registry/providers、handlers、page-translation、shared、popup、content の各役割）
   - **プロバイダー追加手順**（providers/ 1ファイル + registry 登録 + PROVIDER_UI 1エントリ）を
     手順書として明記 — 本リファクタリングの成果を陳腐化させないために最重要
   - 開発コマンド（bun run lint / test）と「変更時はテスト必須」の規約
2. `PROJECT_WIKI.md` のアーキテクチャ図・モジュール説明を更新（または CLAUDE.md へ統合して
   WIKI は利用者向け情報に縮小する。重複維持はまた腐るため、どちらかに寄せる判断をここで行う）。
3. コメント言語の方針を決めて CLAUDE.md に明記（既存比率から**日本語**推奨。「Why を書く」規約と
   セット）。既存コメントの一括翻訳はしない。今後触ったファイルから揃える。
4. `docs/refactoring/` の各フェーズ文書に完了日と実績（計画との差分）を追記し、クローズする。

### 6-5. 最終検証

1. [99-verification-checklist.md](99-verification-checklist.md) の**全項目**を実施（これまでのフェーズは
   関連項目のみで可だったが、最後はフルパス）。
2. 既存ユーザー設定でのアップグレードシナリオ: リファクタ前 main で設定を作り込んだ
   Chrome プロファイルに新版を上書きロードし、全設定が無傷であることを確認。
3. メトリクス比較を記録: ファイル数 / 最大ファイル行数 / プロバイダー追加時の修正箇所数 /
   テスト数・カバレッジ（00-current-state.md の表と対比）。

## 完了条件

- [ ] 旧 action 名がリポジトリから消滅
- [ ] `bun run lint && bun run test` が CI 相当の品質ゲートとして機能（error 0）
- [ ] CLAUDE.md だけ読めば新構造とプロバイダー追加手順が分かる
- [ ] フルスモーク + 設定アップグレードシナリオ PASS
- [ ] メトリクス比較が記録され、目標（プロバイダー追加 ≦ 3 箇所、最大ファイル ≦ 400 行目安）達成

## 将来課題（本計画のスコープ外として記録）

- TypeScript 化 or JSDoc `checkJs` の導入（registry インターフェースの型保証が最大の受益者）
- jQuery / Select2 の置き換え（フェーズ4で接点は1ファイルに集約済み）
- content scripts のバンドル化（フェーズ5の IIFE は ESM へ機械変換可能な形にしてある）
- twitter/youtube content script の manifest レベル分離（フェーズ5の調査結果に従う)
- GitHub Actions 等での lint/test 自動実行

## 実績（2026-06-12）

- 旧 action alias は source / docs とも具体名の参照を削除し、provider 操作は `verifyApiKey` / `getModels`、埋め込み翻訳は `translateEmbeddedText` に統一。
- 追加・更新済みテストは provider registry、OpenAI互換 request shape、settings migration、chunking、logger/error 正規化を対象にし、`bun run test` は 9 files / 37 tests pass。
- `eslint.config.js` に `no-implicit-globals` error、`complexity` / `max-lines-per-function` warning を追加。`bun run lint` は error 0、warning 66。
- `CLAUDE.md` / `PROJECT_WIKI.md` / `README.md` は新構造に合わせて更新。
- メトリクス: source JS 50ファイル、最大ファイル `src/background/message-handlers.js` 435行、popup 最大 291行、content 最大 425行。
- `manifest.json` parse OK。
- フェーズ7後の最終メトリクス: `bun run test` は 10 files / 45 tests pass、`bun run lint` は error 0 /
  warning 29。`message-handlers.js` は 242行、最大ファイルは `src/content/twitter.js` 425行。
- 通常 Chrome の既存プロファイルで、LM Studio 設定復元・popup Test・選択翻訳（main frame / iframe）・
  ページ翻訳・X / YouTube のボタン注入と翻訳・Feature OFF/ON を確認。詳細は
  [99-verification-checklist.md](99-verification-checklist.md) に記録。
- 全プロバイダー実 API 疎通、画像翻訳、ショートカット、20回開閉 listener 確認、既存 Chrome
  プロファイル上書きロードは未実施。フェーズ7で残課題として扱う。
