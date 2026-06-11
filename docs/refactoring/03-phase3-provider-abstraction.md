# フェーズ3: プロバイダー抽象化

対象問題: C-1〜C-5、B-5 残件、F-1 残件（[00-current-state.md](00-current-state.md)）

## 目的

本計画の本丸。「プロバイダー追加 = 約11箇所の修正」を「**1ファイル追加 + registry 登録1行 +
popup 設定1エントリ**」に変える。api.js (1263行) と message-handlers.js (437行) を分割し、
プロバイダーごとの差異を**宣言的な定義オブジェクト**に閉じ込める。

## 前提

- フェーズ2完了（structured-batch / errors / logger / constants が src/shared に存在すること）

## 目標構造

```
src/background/
  ├─ api/
  │   ├─ index.js              # 公開API: translateText / translateTextStream /
  │   │                        #   translateBatchStructured / translateImage / getModels / verifyApiKey
  │   │                        #   （registry を引いて該当プロバイダーに委譲する薄い層）
  │   ├─ registry.js           # PROVIDERS マップ。プロバイダー定義の単一ソース
  │   ├─ http.js               # makeApiRequest / makeStreamingApiRequest / リトライ(429含む) / SSEパース
  │   ├─ openai-compatible.js  # OpenAI互換APIの共通実装（リクエスト構築・レスポンス解釈・
  │   │                        #   structured output 設定）。OpenRouter/Cerebras/Z-AI/Ollama/LM Studio が利用
  │   └─ providers/
  │       ├─ openrouter.js
  │       ├─ gemini.js
  │       ├─ cerebras.js
  │       ├─ zai.js
  │       ├─ ollama.js
  │       ├─ lmstudio.js       # 画像翻訳対応もここに寄せる
  │       └─ chrome-prompt.js  # 既存 chrome-prompt-client.js を取り込み（offscreen 通信）
  ├─ handlers/
  │   ├─ index.js              # action → handler のテーブル dispatch
  │   ├─ translation.js        # startTranslationStream / cancelTranslationStream /
  │   │                        #   embedded text / test translation
  │   └─ providers.js          # verifyApiKey / getModels（汎用2アクション）
  ├─ page-translation/
  │   ├─ service.js            # セッション管理・進捗通知（現 page-translation-service.js の中核）
  │   └─ chunking.js           # チャンク分割の純粋ロジック（テスト対象）
  └─ （settings.js / event-listeners.js / image-translation.js / selection-translation.js /
       streaming.js / logging.js は当面現位置のまま）
```

## プロバイダー定義インターフェース

各 `providers/*.js` が export する形（JSDoc で型定義を `registry.js` に置く）:

```js
export default {
  id: 'openrouter',
  label: 'OpenRouter',
  capabilities: { streaming: true, structuredBatch: true, image: false },
  needsApiKey: true,                    // chromePrompt/ollama/lmstudio は false
  settingsKeys: { apiKey: 'openrouterApiKey', model: 'openrouterModel' },  // 既存キー名を厳守
  defaults: { model: '...' },           // DEFAULT_SETTINGS への寄与分

  translate(text, settings, opts),          // 必須
  translateStream(text, settings, handlers, opts),   // capabilities.streaming 時必須
  translateBatchStructured(texts, settings, opts),   // capabilities.structuredBatch 時必須
  translateImage(image, settings, opts),              // capabilities.image 時必須
  getModels(settings),                  // モデル一覧取得（API キー or サーバURL を settings から）
  verify(settings),                     // キー/接続検証
  describeError(error),                 // 旧 formatErrorDetails のプロバイダー固有部分
}
```

設計上の要点:

- **OpenAI 互換系の共通化が肝**。OpenRouter / Cerebras / Z-AI / Ollama / LM Studio は
  `openai-compatible.js` のファクトリ（`createOpenAICompatibleProvider({ baseUrl, headers, quirks })`）
  から生成し、各ファイルは差分（URL 構築、認証ヘッダ、structured output の方言、リトライ調整）だけ持つ。
  現 `getOpenAICompatibleStructuredConfig` の分岐はここに分解して消す。
- `settings.js` の DEFAULT_SETTINGS は registry から組み立てる
  （`Object.values(PROVIDERS).reduce(...)` + プロバイダー非依存のデフォルト）。
  **生成結果のキー名・値が現状と完全一致**することをテストで固定する。
- `logging.js getProviderMeta` の分岐は `PROVIDERS[id].label` 等の参照に置換。

## タスク

### 3-1. 足場づくり（挙動変更なし）

1. `http.js` を新設し、api.js から `makeApiRequest` / `makeStreamingApiRequest` /
   `readOpenAICompatibleSSE` / 429 リトライ処理を**そのまま**移動。api.js は import で参照。
2. `registry.js` と空の providers/ を作り、まず capabilities 情報
   （現 `getProviderCapabilities`）だけを registry へ移す。
3. スモークテスト（全プロバイダーの選択翻訳1回ずつ）。

### 3-2. プロバイダーを1つずつ切り出す

**順序が重要**。簡単で独立性が高いものから:

1. `gemini.js`（独自 API 形式で OpenAI 互換ファクトリに依存しない）
2. `openai-compatible.js` ファクトリ + `cerebras.js`（最近のコードで一番素直なはず）
3. `openrouter.js` / `zai.js`
4. `ollama.js` / `lmstudio.js`（ローカルサーバ URL 処理・Tailscale 対応 d437a77 を壊さないこと。
   画像翻訳 `translateImageWithLmStudio` も lmstudio.js へ）
5. `chrome-prompt.js`（chrome-prompt-client.js を吸収。offscreen 通信はそのまま）

各ステップで: api.js の対応する `translateWithXxx` / dispatch 分岐を削除 →
`translateText` 等の dispatch を registry 参照に書き換え → 該当プロバイダーのスモーク
（通常翻訳・ストリーミング・ページ翻訳・キー検証・モデル一覧）。

完了時、api.js は `api/index.js`（dispatch のみ、目安 100 行以下）になり、
`formatErrorDetails` は各 provider の `describeError` + 共通部に分解される。

### 3-3. メッセージプロトコルの汎用化（C-3, C-4）

1. `handlers/index.js` を action 名 → ハンドラ関数のテーブルにする（if 連鎖廃止）。
2. 汎用アクションを新設:
   - `verifyApiKey { provider, ...credentials }` → `PROVIDERS[provider].verify()`
   - `getModels { provider, ...credentials }` → `PROVIDERS[provider].getModels()`
3. **互換レイヤ**: provider 別の旧 action 群を新ハンドラへの alias として
   テーブルに残す。popup 側の置換（フェーズ4）が終わった後のフェーズ6で alias を削除する。
   ※ 拡張は background と popup/content が常に同時更新されるため互換レイヤは理論上不要だが、
   フェーズ4を独立してレビュー・revert 可能にするために残す。
4. 旧 Twitter 専用 action の改名（E-4: 実態は埋め込みテキスト翻訳）はここで `translateEmbeddedText` を
   追加し、旧 action を alias 化。content 側の置換はフェーズ5。

### 3-4. page-translation-service.js の分割（C-5）

1. チャンク分割ロジック（テキストノード集合 → maxChars 以下のバッチ列）を `chunking.js` へ
   純粋関数として抽出し、ユニットテストを書く（境界: 1ノードが maxChars 超、空ノード、区切り文字）。
2. セッション管理（tabId → 進行状態、cancel、continue）を `service.js` に残す。
   `continuePageTranslation` / `cancelPageTranslation` の listener 登録は handlers テーブルへ統合。
3. ログは全て logger 経由（フェーズ2の続き）。

### 3-5. 確認

- DEFAULT_SETTINGS スナップショットテスト（registry 組み立て後 == 旧ハードコード）が green。
- 全アクションを smoke。とくに 429 リトライ（38c5d06 の挙動）と LM Studio Tailscale 構成。

## 完了条件

- [ ] 新プロバイダー追加手順が「providers/ に1ファイル + registry 1行 + popup 設定（フェーズ4で1エントリ化）」
      になっていることを、ダミープロバイダーを一時追加して実証（実証後に削除）
- [ ] `api/index.js` にプロバイダー名の switch/if が残っていない（registry 参照のみ）
- [ ] message-handlers の if 連鎖が action テーブルになっている
- [ ] 全特性テスト + 新規テスト（chunking / DEFAULT_SETTINGS / openai-compatible）green
- [ ] スモークテスト全項目 PASS（7プロバイダー × 主要操作のマトリクス。チェックリスト参照）

## リスクと対策

| リスク | 対策 |
|---|---|
| プロバイダー固有の暗黙挙動（ヘッダ、リトライ条件、structured 方言）を共通化で潰す | 1プロバイダーずつ移行し、都度そのプロバイダーだけ集中スモーク。直近の修正コミット（429 共通化、Tailscale 対応、Nano 追加）を移行時に必ず読み直す |
| 移行途中で新旧 dispatch が混在し混乱 | タスク 3-2 の各ステップを 1 コミットに収め、常に全プロバイダーが動く状態を保つ |
| ローカルサーバ系（Ollama/LM Studio）はテスト環境が必要 | 手元にサーバがない場合は「リクエスト URL とボディの組み立て」をユニットテストで固定し、実機確認は可能なタイミングでまとめて行う（未確認項目はチェックリストに記録） |
| chrome-prompt は offscreen + Nano 実機依存 | Nano が使えない環境では verify エラー経路だけでも確認し、残りは要実機と記録 |

## 推奨コミット分割

1. `refactor(api): HTTP/SSE/リトライ層を api/http.js に分離`
2. `refactor(api): プロバイダーregistryを導入しcapabilitiesを移行`
3. `refactor(api): Gemini をプロバイダーモジュールに分離`
4. `refactor(api): OpenAI互換ファクトリを導入し Cerebras を分離`
5. `refactor(api): OpenRouter / Z-AI を分離`
6. `refactor(api): Ollama / LM Studio を分離（画像翻訳含む）`
7. `refactor(api): Chrome Prompt をプロバイダーモジュール化`
8. `refactor(handlers): action テーブル化と verifyApiKey/getModels の汎用化`
9. `refactor(page-translation): チャンク分割を純粋関数として抽出`
