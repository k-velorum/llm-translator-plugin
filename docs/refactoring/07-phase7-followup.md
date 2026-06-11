# フェーズ7: 追加実装計画（残課題の解消）

フェーズ1〜6完了後のレビュー（2026-06-12）で確認された残課題・計画からの逸脱を解消する。
対象: 検証ロジックの置き場所逸脱、message-handlers.js の未分割、lint warning 66件、
未実施の実証・実機検証。

## 背景（レビューで確認された事実）

- フェーズ1〜6の自動検証可能な完了条件はほぼ達成（重複ゼロ、registry 駆動 dispatch、
  旧 action 撤去、DEFAULT_SETTINGS 26キー完全互換、lint error 0、37 tests pass）。
- ただし以下が残った:

| ID | 残課題 | 場所 |
|---|---|---|
| R-1 | **計画逸脱**: API キー検証・モデル一覧取得が provider モジュールではなく `PROVIDER_VERIFIERS` / `PROVIDER_MODEL_LOADERS` マップに実装されている。エンドポイント・ヘッダが `providers/*.js` と二重記述（例: OpenRouter の models URL） | `src/background/message-handlers.js:249-396` |
| R-2 | message-handlers.js が 435 行のまま（計画では handlers/ へ分割予定だった）。翻訳系・provider 操作系・ストリーム管理が同居 | `src/background/message-handlers.js` |
| R-3 | プロバイダー追加時の修正箇所が実質 4〜5 箇所（providers ファイル + registry + 上記2マップ + provider-ui）。目標の「3箇所」に未達 | 同上 + `src/popup/provider-ui.js` |
| R-4 | lint warning 66件: no-unused-vars 34 / complexity 16 / max-lines-per-function 13 / no-useless-escape 3 | 全域 |
| R-5 | フェーズ3完了条件「ダミープロバイダーでの追加手順実証」が未実施 | — |
| R-6 | **実機 Chrome でのスモークテストに未確認項目が残っている**（LM Studio 基準点スモークは一部実施済み。全プロバイダー・画像翻訳・アップグレード互換は未実施） | [99-verification-checklist.md](99-verification-checklist.md) |

## 進め方の方針: 実機検証を先に行う

フェーズ1〜6で約45コミットの構造変更が入り、実機確認は LM Studio を使った基準点スモークの
一部に留まっている。この上にさらにリファクタリングを積むと、問題発覚時にどのコミットが原因か
切り分けづらくなる。
よって本フェーズは以下の順で進める:

```
7-0 実機スモーク（基準点の確定）→ 問題があれば修正を先に完了
   ▼
7-1 verify/getModels の provider モジュール移設（R-1, R-3）
   ▼
7-2 message-handlers の分割（R-2）
   ▼
7-3 lint warning の削減（R-4）
   ▼
7-4 ダミープロバイダー実証（R-5）
   ▼
7-5 最終実機スモーク + 記録（R-6 クローズ）
```

## タスク

### 7-0. 基準点スモークテスト（R-6 前半）

1. [99-verification-checklist.md](99-verification-checklist.md) のうち実機必須の最小セットを実施:
   - セクション 0（起動・基本）、1（選択翻訳）、2（ページ翻訳）を手元で使える
     プロバイダー1つ（OpenRouter または Gemini 推奨）で。
   - セクション 8 のアップグレード互換: リファクタ前（c8124c2）で設定を保存した
     プロファイルに現 HEAD を上書きロードし、設定が無傷なことを確認。
2. X / YouTube / 画像翻訳 / ローカルサーバ系は環境が用意でき次第。**未実施項目は
   チェックリストの実施記録に日付付きで残す**（既存の記録様式を踏襲）。
3. 不具合が出た場合: 本フェーズの残りタスクを**中断**し、`git bisect`（45コミットあるため有効）
   で原因コミットを特定 → 修正コミット → 再スモークまでを先に完了する。

### 7-1. verify / getModels の provider モジュール移設（R-1, R-3）

レビューで確認した現挙動を**完全に維持**したまま、実装の置き場所だけを正す。

1. 各 provider モジュールに `verify(message, settings)` と `getModels(message, settings)` を追加:
   - `openrouter.js` — models URL・`OPENROUTER_HEADERS_BASE` は既存定義を再利用し二重記述を解消
   - `gemini.js` / `cerebras.js` — 同様
   - `ollama.js` / `lmstudio.js` — getModels のみ（現状 verify は未提供。**現状どおり**とする）
     - フォールバック順序を厳守: `message.apiKey || settings.cerebrasApiKey`、
       `message.server || settings.ollamaServer || 'http://localhost:11434'` 等。
       Cerebras の「キーなし時は public エンドポイント + format=openrouter」分岐も維持
   - `zai.js` / `chrome-prompt.js` — どちらも未提供（popup 側も呼ばない）。**追加しない**
2. `message-handlers.js` の `handleVerifyApiKey` / `handleGetModels` を
   `getProviderDefinition(provider)?.verify / ?.getModels` への委譲に書き換え、
   `PROVIDER_VERIFIERS` / `PROVIDER_MODEL_LOADERS` マップを削除。
   未対応プロバイダーへの応答メッセージ（`未対応のプロバイダーです: ...`）は変えない。
3. 応答形状を厳守: verify は `{ result: { success: true, models? } }`、
   getModels は `{ models }`、エラーは `{ error: normalizeError(...) }`。
   OpenRouter verify のみ `models` を同梱している現挙動も維持（popup が参照していないか
   確認の上、参照していなければ「維持」をやめて簡素化してもよい — 確認結果をコミット本文に記す）。
4. テスト: 既存の provider テスト（`test/openrouter-zai-provider.test.js` 等）に
   verify/getModels のリクエスト URL・ヘッダ・フォールバック順序のケースを追加。
   とくに **LM Studio の Tailscale 任意ホスト（d437a77）** と
   **Cerebras キーなし public エンドポイント**は回帰テスト必須。
5. registry の JSDoc 型（`ProviderDefinition`）に verify/getModels を正式フィールドとして記載。

### 7-2. message-handlers.js の分割（R-2）

7-1 完了後の行数を見て判断する。**7-1 でマップ約150行が消えるため、300行を切るなら
分割しない**（規模に見合わない複雑化を避ける。判断結果を本文書の実績欄に記録）。
分割する場合は当初計画どおり:

```
src/background/handlers/
  ├─ index.js        # ACTION_HANDLERS テーブルと handleBackgroundMessage（dispatch のみ）
  ├─ translation.js  # ストリーム管理（activeStreams）・embedded・testTranslate
  └─ providers.js    # verifyApiKey / getModels の委譲ハンドラ
```

- `background.js` の import 先変更を忘れない。`message-handlers.js` は再 export の
  シムとして1リリース分残すか、参照箇所が background.js のみなら即削除。

### 7-3. lint warning の削減（R-4）

現状 66件。**機械的に消せるものから**着手し、閾値緩和で誤魔化さない:

1. `no-useless-escape`(3) — 正規表現の不要エスケープ除去。挙動同一性をテストで担保
   （対象が structured-batch / chunking 系なら既存テストで足りる）。
2. `no-unused-vars`(34) — 未使用変数・import の削除。「`_` プレフィクス付きは許容」の
   設定（`argsIgnorePattern: '^_'`）を eslint.config.js に追加し、意図的な未使用引数と
   死んだコードを区別する。
3. `complexity`(16) / `max-lines-per-function`(13) — 全てを潰すことは目標にしない。
   対象を列挙し、次の基準で2分する:
   - **特性テストで保護済みの純粋関数**（例: `normalizeStructuredBatchResult` complexity 20）
     → 早期 return 化・ヘルパ抽出で素直に分解する
   - **UI・ハンドラ系の長い関数** → 分解が挙動リスクに見合うか個別判断。見送る場合は
     `// eslint-disable-next-line` ではなく**そのまま warning として残し**、件数を実績欄に記録
4. 目標値: warning **30件以下**（unused/escape 全消し + complexity 系の半減）。
   0件は本フェーズの目標にしない。

### 7-4. ダミープロバイダー実証（R-5）

1. ブランチ上で架空プロバイダー（例: `dummy`、OpenAI 互換 factory 利用）を追加し、
   触ったファイルを記録する。期待値:
   - `src/background/api/providers/dummy.js`（新規）
   - `src/background/api/registry.js`（登録1エントリ）
   - `src/popup/provider-ui.js`（UI 1エントリ）
   - （必要時のみ）`src/popup/provider-default-models.js`
2. popup でセクションが出现し、設定保存→翻訳テストのエラー経路まで動くことを確認。
3. 結果（修正ファイル数・所要箇所）を本文書の実績欄と CLAUDE.md の
   「プロバイダー追加手順」に反映し、**実証コミットは revert**（履歴に手順の証拠として残す）。
4. 4箇所を超えた場合はその原因を記録し、3〜4箇所に収める追加修正を検討する。

### 7-5. 最終実機スモークと記録（R-6 クローズ）

1. [99-verification-checklist.md](99-verification-checklist.md) の**全項目**を実施
   （実機が用意できない項目は従来どおり「未確認 + 日付」で記録し、未確認リストを残す）。
2. プロバイダーマトリクスの表を実施結果（✓ / 未確認）で埋める。
3. README の実施結果セクションと各フェーズ文書の実績欄を最終化する。

## 完了条件

- [ ] 7-0 の基準点スモークが PASS（または発見された不具合の修正が完了）している
- [ ] `PROVIDER_VERIFIERS` / `PROVIDER_MODEL_LOADERS` が消滅し、provider のエンドポイント
      記述が `providers/*.js` 内に閉じている（grep で URL の二重記述ゼロを確認）
- [ ] verify/getModels のフォールバック順序・応答形状の回帰テストが green
- [ ] message-handlers.js の分割可否が判断・記録され、分割した場合は各 200 行前後
- [ ] lint warning が 30 件以下で、残存分の内訳が実績欄に記録されている
- [ ] ダミープロバイダー実証の結果（修正箇所数）が記録され、CLAUDE.md の手順と一致している
- [ ] チェックリスト全項目が「PASS or 未確認（日付付き）」で埋まっている

## リスクと対策

| リスク | 対策 |
|---|---|
| 実機スモーク前にリファクタを積んで原因切り分け不能になる | 7-0 を最初に実施し、PASS するまで 7-1 以降に着手しない |
| verify/getModels 移設でフォールバック順序や応答形状が微妙に変わり popup が壊れる | 移設前に現挙動をテストで固定（URL・ヘッダ・フォールバックのユニットテスト）。popup 側の応答参照箇所（`result.success` / `models`）を grep で確認してから着手 |
| complexity 解消のための分解で挙動が変わる | テスト保護のある関数のみ分解。保護のないものは見送って warning のまま記録 |
| ダミープロバイダーの消し忘れ | 実証は専用ブランチで行い、main には記録のみ反映 |

## 推奨コミット分割

1. `docs(refactor): 基準点スモークの実施結果を記録`（修正が出た場合は別コミット）
2. `test(api): verify/getModels の現挙動を固定する回帰テストを追加`
3. `refactor(api): APIキー検証とモデル一覧取得をproviderモジュールへ移設`
4. `refactor(handlers): message-handlers を分割`（7-2 で実施判断した場合のみ）
5. `chore(lint): 未使用変数と不要エスケープを解消`
6. `refactor: complexity警告の高い純粋関数を分解`
7. `docs: ダミープロバイダー実証と最終スモークの結果を記録`

## 実績（実施後に記入）

- 7-0 基準点スモーク: 2026-06-12 に通常 Chrome 既存プロファイルで LM Studio 設定復元・popup Test・
  選択翻訳（main frame / iframe）・ページ翻訳・X / YouTube のボタン注入と翻訳・Feature OFF/ON を確認。
  未確認項目は [99-verification-checklist.md](99-verification-checklist.md) に日付付きで記録。
- 7-1 移設:
- 7-2 分割判断:
- 7-3 lint warning 件数推移:
- 7-4 実証結果（修正ファイル数）:
- 7-5 最終スモーク:
