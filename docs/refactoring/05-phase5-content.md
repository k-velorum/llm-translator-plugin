# フェーズ5: content script 層の整理

対象問題: E-1〜E-9、F-2、B-7 残件（[00-current-state.md](00-current-state.md)）

## 目的

8ファイルがトップレベル変数を暗黙共有する構造を、**明示的な名前空間 + 初期化順序の宣言**に
変える。UI 部品（ポップアップ・スピナー・ボタン）とメッセージ送信を共通化し、
リスナー/Observer のライフサイクルを管理下に置く。

## 前提

- フェーズ3完了（`translateEmbeddedText` alias が background に存在すること）
- フェーズ4とは独立。並行作業可

## 技術方針の決定: ビルドレス + 名前空間（IIFE）

content scripts は ES Modules を直接サポートしないため、選択肢は2つ:

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A. 名前空間（採用）** | 各ファイルを IIFE で包み、単一グローバル `LLMT` に公開物を登録 | ビルド不要、デバッグ容易、現行構成からの差分最小 | shared コードを background と二重管理（対象は小さい） |
| B. esbuild バンドル | src/content を ESM で書き bundle | import 可、shared 完全共有 | ビルド工程・ソースマップ管理が増える。規模に対して過剰 |

現規模（content 計 約1,900行）では A を採用。**B への移行パスは A の完了後も閉じない**
（IIFE 内部は ESM とほぼ同形のため機械的に変換可能）。

```js
// 各ファイルの形:
(() => {
  'use strict';
  const { styles, createSpinner, sendBackgroundMessage } = window.LLMT.ui;
  // ...
  window.LLMT.twitter = { init, dispose };   // 公開するものだけ登録
})();
```

## 目標構造（ファイル分割は維持、役割を再定義）

```
src/content/
  ├─ namespace.js        # 新設・最初にロード。window.LLMT = {} と共通定数（セレクタ、タイムアウト、サイズ）
  ├─ messaging.js        # 新設。sendBackgroundMessage（lastError/response.error の統一判定）、
  │                      #   ストリーミング受信の購読ヘルパ（現 streaming.js を吸収）
  ├─ ui.js               # 新設。スピナー・ポップアップシェル・翻訳ボタン・SVGアイコン・スタイル注入
  │                      #   （shared.js の styles と selection/page-translation/twitter/youtube の重複 UI を吸収）
  ├─ settings.js         # 新設。featureSettings/キャッシュ設定のロードと onChanged 購読（Promise ベース）
  ├─ selection.js        # 選択テキスト翻訳（UI は ui.js を利用）
  ├─ page-translation.js # ページ翻訳の表示制御
  ├─ twitter.js          # Twitter 固有: セレクタ・Observer・キャッシュ（設定と実装をここに統合）
  ├─ youtube.js          # YouTube 固有
  └─ runtime.js          # コンテキストメニュー/ショートカット起点の受信
content.js               # エントリ: LLMT.init() を呼ぶだけ（現行同様）
```

manifest.json の `js` 配列を新しい依存順に更新:
`namespace → messaging → settings → ui → selection → page-translation → twitter → youtube → runtime → content.js`

## タスク

### 5-1. 名前空間導入（E-1）

1. `namespace.js` を新設し、manifest の先頭に追加。
2. 既存ファイルを1つずつ IIFE で包み、トップレベル `let` を IIFE 内へ移して公開物だけ
   `LLMT.*` に登録。**1ファイル = 1コミット**で、各コミット後にそのファイルが担う機能をスモーク。
   - 順序: shared.js → streaming.js → selection.js → page-translation.js → twitter.js → youtube.js → runtime.js
   - shared.js はこの過程で ui.js / settings.js / namespace.js に分解して消す（5-2, 5-4 と連動）。
3. 完了後、content 配下のトップレベル宣言が `window.LLMT` への登録以外に存在しないことを
   ESLint（`no-implicit-globals` 相当の設定）で強制し、フェーズ1で許容した
   グローバル列挙を eslint config から削除する。

### 5-2. UI 部品の統合（E-3, E-7、B-7 残件）

1. `ui.js` に集約:
   - `createSpinner()` — selection.js / page-translation.js の重複実装を統合
   - `createTranslateButton(platformStyle)` — twitter.js / youtube.js の SVG ボタン重複を統合
   - ポップアップシェル生成（`createSelectionPopup` / `showLoadingPopup` の共通骨格）と
     `positionPopupInViewport`
   - スタイル注入の一本化（`ensure...SpinnerStyles` ×2 を統合、style 要素 id は既存を維持）
2. セレクタ定数を各プラットフォームファイルの先頭に集約（`TWEET_SELECTOR` 等）。
   汎用定数（POPUP_MARGIN、タイムアウト 200000ms 等）は namespace.js へ。
   ※ `src/shared/constants.js`（フェーズ2）と値を揃え、相互にコメントで参照を残す
   （ビルドレスの代償としての管理された二重化。値の出典コメント必須）。

### 5-3. メッセージングの統一（E-4, F-2）

1. `messaging.js` に `sendBackgroundMessage(action, payload)` を実装:
   - `chrome.runtime.lastError` / `response?.error` / 応答なし を一律に判定して
     `{ ok, data, error }` に正規化。コンテキスト無効化（拡張リロード後の孤児 content script）も
     ここで握って静かに失敗させる。
2. 全 `chrome.runtime.sendMessage` 呼び出しを置換。
3. youtube.js の `translateTweet` 利用を `translateEmbeddedText`（フェーズ3で追加済み）に変更。
   twitter.js も同 action へ移行し、background 側 alias 削除（フェーズ6）の前提を作る。

### 5-4. 設定購読とキャッシュの整理（E-6）

1. `settings.js`（content 側）に `loadFeatureSettings` / `registerFeatureSettingsListener` を移し、
   **Promise を返す初期化**にする。content.js のエントリは
   `await LLMT.settings.ready()` 後に各機能を init する（初期化レースの解消）。
2. ツイート翻訳キャッシュ（Map、in-flight 管理、スコープ再計算）を twitter.js 内の
   1オブジェクト（`createTweetTranslationCache(settings)`) に統合。
   shared.js にあった `tweetTranslationCacheSettings` を移す。

### 5-5. リスナー / Observer のライフサイクル管理（E-2, E-5）

1. selection.js のポップアップに「開く時に登録したリスナーを閉じる時に必ず解除する」構造を導入
   （登録時に解除関数を配列に積み、`removePopup` で flush する方式）。多重登録を排除。
2. Observer を `createObserverController({ start, stop, isEnabled })` に統一し、
   twitter.js / youtube.js それぞれの開始・停止・設定変更時の再構成を1箇所に。
   disconnect の try-catch 握り潰しをやめ、logger（console ラッパ。content 用の軽量版を
   messaging.js か namespace.js に置く）で warn を出す。
3. `runtime.js` の `getSelectedText` ハンドラは送信側の存在を grep で最終確認し、
   不在なら削除（E-8）。

### 5-6. 注入範囲の検討（E-9）— 調査と記録のみ

`<all_urls>` への 8 ファイル注入は選択翻訳・ページ翻訳が任意サイトで動く要件上必要。
ただし twitter.js / youtube.js を `content_scripts` の別エントリ（matches を x.com / youtube.com に
限定）へ分離する案は有効。**namespace 化（5-1）完了後なら分離は容易**になるため、
本フェーズでは manifest 分離の実験と計測（注入コスト）だけ行い、採否を記録する。
採用する場合も別コミット・全サイトスモーク必須。

## 完了条件

- [ ] content 配下に IIFE 外のトップレベル宣言がない（ESLint で機械的に保証）
- [ ] スピナー・翻訳ボタン・ポップアップ骨格・スタイル注入の実装が各1つ
- [ ] `sendMessage` 直呼びが残っていない（messaging.js 経由のみ）
- [ ] `translateTweet` action を送る箇所が content にない
- [ ] 選択ポップアップを 20 回開閉して document のリスナーが増殖しないことを DevTools
      （`getEventListeners(document)`）で確認
- [ ] スモークテスト全項目 PASS。特に: X のタイムライン無限スクロール中のボタン注入、
      YouTube コメント翻訳、設定 OFF→ON 切り替え後の Observer 再開、拡張リロード直後の古いタブ

## リスクと対策

| リスク | 対策 |
|---|---|
| manifest のロード順変更ミスで未定義参照 | 1ファイルずつ IIFE 化し、毎コミットでスモーク。namespace.js は最初に追加 |
| ポップアップ UI 統合で位置計算・見た目が微妙に変わる | 統合前後でスクリーンショット比較（主要3パターン: 選択翻訳・ローディング・エラー） |
| Twitter/YouTube の DOM 仕様変更と区別がつかなくなる | リファクタ前に現 main で各機能が動くことを確認してから着手（壊れていたら先に記録） |
| 拡張リロード後の孤児 content script でエラー多発 | messaging.js のコンテキスト無効化ハンドリングで吸収。既存挙動より悪化させない |

## 推奨コミット分割

1. `refactor(content): LLMT 名前空間を導入`
2. `refactor(content): shared.js を ui/settings/namespace に分解`（複数コミット可）
3. `refactor(content): 各ファイルを IIFE 化しグローバル共有を廃止`（ファイルごと）
4. `refactor(content): メッセージ送信を messaging.js に統一し translateEmbeddedText へ移行`
5. `refactor(content): Observer とポップアップのライフサイクル管理を導入`
6. `chore(content): 未使用ハンドラ削除・セレクタ定数集約`
