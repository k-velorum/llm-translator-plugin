# 現状分析（2026-06-11 / main: c8124c2）

リファクタリング対象の問題点インベントリ。各フェーズ文書はここの項目 ID を参照する。
行番号は調査時点のもので、作業時には乖離している可能性がある。シンボル名を優先して特定すること。

## メトリクス

| 指標 | 値 |
|---|---|
| 総行数（JS/HTML/JSON/MD/sh、lib 除く） | 約 8,700 行 |
| 最大ファイル | `src/background/api.js` 1,263 行 |
| 2番目 | `popup.js` 1,173 行 |
| 3番目 | `src/background/page-translation-service.js` 724 行 |
| 対応プロバイダー数 | 7（OpenRouter / Gemini / Cerebras / Z-AI / Ollama / LM Studio / Chrome Gemini Nano） |
| メッセージ action 数 | 14 + offscreen 内部プロトコル |
| `console.*` 呼び出し | 約 84 箇所（ログ基盤 `logging.js` はページ翻訳でのみ利用） |
| package.json / リンタ / テスト | なし |
| `var` 使用 / TODO・FIXME | なし（良好） |

## ファイル構成と読み込み方式

| 層 | エントリ | 方式 | 備考 |
|---|---|---|---|
| background | `background.js` → `src/background/*` | ES Modules | 構造は良好。ファイル肥大が問題 |
| offscreen | `offscreen.html` → `src/offscreen/chrome-prompt-runtime.js` | **ES Module**（`type="module"`） | import 可能なのに重複コードを抱えている |
| content | manifest で 8 ファイルを順序ロード | classic script（グローバル共有） | `shared.js` → `streaming.js` → `selection.js` → `page-translation.js` → `twitter.js` → `youtube.js` → `runtime.js` → `content.js` |
| popup | `popup.html` → jquery → select2 → `popup.js` | classic script | module 化すれば settings.js を import 可 |

---

## 問題点インベントリ

深刻度: ★★★=高（設計上の根本問題） / ★★=中 / ★=低（クリーンアップ）

### A. プロジェクト衛生（→ フェーズ1）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| A-1 | ★★★ | テスト・リンタ・フォーマッタ・package.json が一切ない。リファクタリングの安全網が存在しない | リポジトリ全体 |
| A-2 | ★★ | CLAUDE.md の「Code Structure」が実装と乖離。`page-translation-service.js`、`image-translation.js`、`streaming.js`×2、`chrome-prompt-client.js`、`logging.js`、`src/content/` の7ファイル、`src/offscreen/` が未記載 | `CLAUDE.md` |
| A-3 | ★★ | PROJECT_WIKI.md がプロバイダー4つ時代の記述のまま（Cerebras / Z-AI / Chrome Gemini Nano 未記載） | `PROJECT_WIKI.md` |
| A-4 | ★ | `required.md` は OpenRouter/Gemini のみ記載の初期要件書。現状と乖離しており役目を終えている | `required.md` |
| A-5 | ★ | アイコン PNG は同梱済みなのに README/CLAUDE.md が「生成が必要」と案内。`create_icons.sh` と `icons/README.md` の記述も矛盾 | `create_icons.sh`, `icons/README.md`, `CLAUDE.md` |
| A-6 | ★ | `.serena/` が untracked で放置。`.jj/` も .gitignore 未記載 | `.gitignore` |
| A-7 | ★ | `web_accessible_resources` で `lib/*` を全 URL に公開しているが、jQuery/Select2 は popup 内でしか使われない可能性が高い（要検証） | `manifest.json` |

### B. 重複コード（→ フェーズ2）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| B-1 | ★★★ | **完全重複**: `STRUCTURED_BATCH_SCHEMA` / `buildStructuredBatchInstruction` / `parseJsonLoose` / `normalizeStructuredBatchResult` が api.js と offscreen runtime に二重定義。offscreen は ES Module なので import で即解消可能 | `src/background/api.js:33-219` ⇔ `src/offscreen/chrome-prompt-runtime.js:6-326` |
| B-2 | ★★ | デフォルトプロンプト定数が popup.js に再定義（settings.js が単一ソースであるべき） | `popup.js:3-6` ⇔ `src/background/settings.js:1-7` |
| B-3 | ★★ | デフォルト値・上限値の分散: `pageTranslationMaxChars` 等が `settings.js` の DEFAULT_SETTINGS と `page-translation-service.js` 冒頭の定数で二重管理 | `src/background/settings.js`, `src/background/page-translation-service.js:10-22` |
| B-4 | ★ | `sleep()`（page-translation-service.js）と `sleepWithSignal()`（api.js）が別々に定義 | `src/background/page-translation-service.js:32`, `src/background/api.js:321` |
| B-5 | ★★ | エラー整形が4方式並立: `formatErrorDetails` / `{message, details}` 直組み / `normalizeStreamError` / `serializeError` | api.js, message-handlers.js, streaming.js, chrome-prompt-runtime.js |
| B-6 | ★★ | ログが `console.*` 直書き約84箇所と `appendLog`（logging.js、ページ翻訳のみ）の二本立て。API キーを含む設定オブジェクトがログに渡るリスク（`sanitizeMessageForLog` は background.js のみ） | 全域 |
| B-7 | ★ | タイムアウト値 180000ms 等が api.js / page-translation-service.js / chrome-prompt-client.js / content の page-translation.js にハードコード散在 | 複数 |

### C. プロバイダー抽象の欠如（→ フェーズ3）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| C-1 | ★★★ | api.js (1263行) に7プロバイダーの実装・dispatch・SSE パース・リトライ・エラー整形・画像翻訳が同居 | `src/background/api.js` |
| C-2 | ★★★ | プロバイダー追加に約11箇所の修正が必要: `getProviderCapabilities` / `getOpenAICompatibleStructuredConfig` / `formatErrorDetails` / `translateText` dispatch / `translateTextStream` dispatch / `translateBatchStructured` dispatch / verify ハンドラ / getModels ハンドラ / DEFAULT_SETTINGS / `logging.js getProviderMeta` / popup UI | api.js, message-handlers.js, settings.js, logging.js, popup.js/html |
| C-3 | ★★ | メッセージ API がプロバイダーごとに増殖: `verifyOpenrouterApiKey` / `verifyCerebrasApiKey` / `verifyGeminiApiKey` / `getOpenrouterModels` / `getCerebrasModels` / `getGeminiModels` / `getOllamaModels` / `getLmstudioModels`。汎用 `verifyApiKey {provider}` / `getModels {provider}` で統合可能 | `src/background/message-handlers.js:263-431` |
| C-4 | ★★ | message-handlers.js (437行) が if 連鎖による単一 dispatch。翻訳系と設定検証系の責務混在 | `src/background/message-handlers.js` |
| C-5 | ★★ | page-translation-service.js (724行) にセッション管理・チャンク分割・進捗通知・ログが混在 | `src/background/page-translation-service.js` |
| C-6 | ★ | `OPENROUTER_HEADERS_BASE` 定数があるのに getOpenrouterModels では別途ハードコード | `src/background/api.js:28-31` |
| C-7 | ★ | 「Anthropic は削除済み」等の死んだコメントが残存 | api.js:903 付近, message-handlers.js:289,305, settings.js:46 |

### D. popup の構造問題（→ フェーズ4）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| D-1 | ★★★ | プロバイダーごとの if/else 重複が4大関数に蔓延: `loadProviderModels`(82行) / `loadSettings` / `saveSettings` / `testApi`(133行・7分岐) | `popup.js:202-283, 803-1088` |
| D-2 | ★★ | popup.html のプロバイダー設定セクションがほぼ同型マークアップ ×6 の繰り返し | `popup.html:405-522` |
| D-3 | ★★ | `updateModelInfo` / `validateApiKey` もプロバイダー分岐内蔵。registry 化で新プロバイダー時の修正箇所を削減可能 | `popup.js:48-63, 155-194` |
| D-4 | ★ | ステータス表示が2方式: `showStatus`（CSS クラス）と `verifyApiKey` 内の `style.color` 直接代入＋色ハードコード | `popup.js:752-779, 1090-1097` |
| D-5 | ★ | jQuery 利用は実質 Select2 の初期化まわり約16箇所のみ。依存約100KB | `popup.js`, `lib/` |
| D-6 | ★ | レガシープロンプト形式からの移行判定が popup.js にも埋め込まれ settings.js と二重実装 | `popup.js:854-873` |

### E. content 層の構造問題（→ フェーズ5）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| E-1 | ★★★ | ファイル間共有がトップレベル `let`（`translationPopup` / `tweetObserver` / `ytObserver` / `featureSettings` 等）のグローバル暗黙依存。ロード順が壊れると無言で破綻 | `src/content/shared.js:1-15` ほか全域 |
| E-2 | ★★ | `closePopupOnClickOutside` 等 document へのリスナーが removePopup 時に確実に解除されない疑い（リーク・多重登録） | `src/content/selection.js:250, 370, 386-389` |
| E-3 | ★★ | ポップアップ/スピナー/ボタンの UI 生成が selection.js / page-translation.js / twitter.js / youtube.js で個別実装。SVG アイコンも二重定義 | `src/content/` 全域 |
| E-4 | ★★ | YouTube コメント翻訳が Twitter 用の `action: 'translateTweet'` を流用。命名が実態と乖離 | `src/content/youtube.js:153` |
| E-5 | ★★ | Observer のライフサイクル（開始/停止/設定変更時の再構成）が分散し、disconnect 失敗が握り潰される | `src/content/shared.js:41-78`, twitter.js, youtube.js |
| E-6 | ★★ | ツイート翻訳キャッシュの設定は shared.js、実装は twitter.js とスコープ分裂。初期化と storage.onChanged のレース懸念 | `src/content/shared.js:195`, `src/content/twitter.js:1-85` |
| E-7 | ★ | セレクタ・マジックナンバー（`article[data-testid="tweet"]`、POPUP_MARGIN 等）の散在 | twitter.js, youtube.js, shared.js |
| E-8 | ★ | `runtime.js` の `getSelectedText` ハンドラに対応する送信側が見当たらない（要確認のうえ削除） | `src/content/runtime.js:61-65` |
| E-9 | ★ | 全サイト (`<all_urls>`, all_frames) に 8 ファイル注入。Twitter/YouTube 機能は実行時 if で抑制しているだけ | `manifest.json` |

### F. 横断的な一貫性（→ フェーズ2・3で吸収）

| ID | 深刻度 | 問題 | 場所 |
|---|---|---|---|
| F-1 | ★★ | sendResponse / `return true` の非同期ハンドリング様式がハンドラごとに揺れる | message-handlers.js |
| F-2 | ★ | content 側の応答エラー判定が `response.ok` / `response?.error` / `chrome.runtime.lastError` 混在 | content 全域 |
| F-3 | ★ | コメント言語が日英混在 | 全域 |
