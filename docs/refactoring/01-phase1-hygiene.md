# フェーズ1: プロジェクト衛生・開発基盤

対象問題: A-1〜A-7（[00-current-state.md](00-current-state.md)）

## 目的

以降のフェーズで安全にコードを動かすための**安全網**（lint・テスト実行環境）を整え、
リポジトリの不要物とドキュメントの嘘を先に片付ける。コードの挙動には一切手を触れない。

## 前提

- なし（最初のフェーズ）

## タスク

### 1-1. リポジトリ掃除（A-4, A-5, A-6）

1. `required.md` を削除する（初期要件書。README.md / PROJECT_WIKI.md が現役のため役目終了）。
2. `.gitignore` に追記: `.jj/`, `.serena/`, `node_modules/`, `coverage/`。
3. `create_icons.sh` を `scripts/create_icons.sh` へ移動し、`icons/README.md` を「PNG は同梱済み。再生成する場合のみ scripts/create_icons.sh を使う」という内容に書き直す。

### 1-2. package.json と開発ツール導入（A-1）

ランタイム依存は増やさない（拡張本体はビルドレスのまま）。**devDependencies のみ**。

1. `bun init` 相当の最小 `package.json` を作成（`private: true`）。パッケージ管理はリポジトリ規約に従い bun を優先。
2. ESLint を導入:
   - flat config（`eslint.config.js`）。
   - 環境別グローバル定義を分ける: background/offscreen（ESM, `chrome`）、content（script, `chrome` + 自前グローバル）、popup（script, `chrome`, `$`, jQuery）。
   - content script のグローバル相互参照は現状やむを得ないため、フェーズ5まで `no-undef` のグローバル列挙で許容する。
   - ルールは recommended ベース + `no-unused-vars` / `eqeqeq` / `no-var` 程度に留める。スタイル論争になるルールは入れない。
3. Prettier を導入（`.prettierrc`）。**一括フォーマットはしない**。`git diff` に現れた変更ファイルのみ随時整形する方針をここに明記する。
4. Vitest を導入（テストランナー。jsdom は現時点で不要、純粋関数テストのみ）。
5. `package.json` の scripts: `lint`, `format`, `test`。

### 1-3. 特性テストの初期整備（A-1、フェーズ2の前提）

フェーズ2で移動・統合する純粋関数に対し、**現在の挙動を固定する**テストを先に書く。

対象（いずれも DOM / chrome API 非依存の純粋関数）:

| 関数 | 場所 | テスト観点 |
|---|---|---|
| `parseJsonLoose` | `src/background/api.js:72` | 正常 JSON / コードフェンス付き / 前後ゴミ付き / 壊れた JSON |
| `normalizeStructuredBatchResult` | `src/background/api.js:180` | id 完全一致 / 欠落 id のフォールバック / 余剰 id |
| `buildStructuredBatchInstruction` | `src/background/api.js:57` | settings の各パターンで出力固定 |
| `loadSettings` のレガシー移行分岐 | `src/background/settings.js:50-73` | 旧結合プロンプト形式 → 新形式の変換 |

注意: api.js は ES Module なので Vitest からそのまま import できるが、モジュール読み込み時に
chrome API へ触れる副作用がないか確認する。ある場合はテスト対象関数の export 追加のみ行い、
ロジック変更はしない（テスト容易性のための本格的な分離はフェーズ2以降で行う）。

### 1-4. ドキュメントの嘘を直す（A-2, A-3, A-5）

実装の説明はこの時点の構造に合わせて**事実だけ**更新する（理想構造はフェーズ6で反映）。

1. `CLAUDE.md` の「Architecture > Code Structure」を全ファイル網羅に更新:
   - `src/background/`: api.js / message-handlers.js / settings.js / event-listeners.js / page-translation-service.js / selection-translation.js / image-translation.js / streaming.js / chrome-prompt-client.js / logging.js
   - `src/content/`: shared.js / streaming.js / selection.js / page-translation.js / twitter.js / youtube.js / runtime.js
   - `src/offscreen/`: chrome-prompt-runtime.js（offscreen document、Chrome Prompt API 実行環境）
   - content scripts のロード順依存（manifest.json の `js` 配列順）を明記。
2. `CLAUDE.md` の Development Setup から「アイコン生成必須」の記述を削除し、1-1 の新しい説明に差し替え。
3. `PROJECT_WIKI.md` のプロバイダー一覧に Cerebras / Z-AI / Chrome Gemini Nano（offscreen 経由）を追記。画像翻訳・YouTube コメント翻訳・ページ翻訳の現行機能を反映。
4. `README.md` は概ね正確なため、開発セットアップ節に `bun install` / `bun run lint` / `bun run test` を追記するのみ。

### 1-5. manifest 権限の棚卸し（A-7）— 調査のみ

`web_accessible_resources` の `lib/*` 公開が本当に必要か検証する:

1. `lib/` 参照箇所を grep（popup.html 以外に `chrome.runtime.getURL('lib/...')` 等があるか）。
2. 不要と確認できたら削除し、スモークテスト（チェックリスト全項目）を実施。
3. 確認できない・疑義が残る場合は**触らず**、調査結果をこの文書に追記して終了。

`host_permissions` の縮小は Ollama/LM Studio の任意ホスト:ポート対応（Tailscale 含む）が
壊れるリスクがあるため**本計画では実施しない**。

## 完了条件

- [ ] `bun run lint` がエラー 0 で通る（warning は許容し、件数を記録）
- [ ] `bun run test` が通り、1-3 の特性テストが全て green
- [ ] `required.md` が消え、`.gitignore` が更新されている
- [ ] CLAUDE.md / PROJECT_WIKI.md / icons/README.md が現実と一致している
- [ ] 拡張を Chrome に読み込み直してスモークテスト全項目 PASS（[99-verification-checklist.md](99-verification-checklist.md)）

## リスクと対策

| リスク | 対策 |
|---|---|
| ESLint 導入で大量のエラーが出て手が止まる | ルールを最小から始める。既存違反は warning に落とすか一時的に off |
| api.js import 時の副作用でテストが落ちる | テスト不能な関数は無理に対象にせずフェーズ2へ先送り（記録を残す） |
| web_accessible_resources 削除で popup が壊れる | popup は web_accessible_resources 不要のはずだが、削除後に必ず全スモーク実施。疑義があれば見送り |

## 推奨コミット分割

1. `chore: 不要ファイル削除と .gitignore 整備`
2. `build: package.json と ESLint/Prettier/Vitest を導入`
3. `test: 構造化バッチ/JSONパース/設定移行の特性テストを追加`
4. `docs: CLAUDE.md と PROJECT_WIKI.md を現行実装に同期`
5. `chore(manifest): web_accessible_resources の lib 公開を削除`（実施した場合のみ）
