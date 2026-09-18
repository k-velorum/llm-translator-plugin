# 選択置換のブラウザテスト

リポジトリのルートをHTTPで配信し、`/test/browser/selection-replacement.html` をChromeで開きます。DOMのRange・MutationObserverを使う28ケースを実行し、各ケースの `ok` を表示します。追加のテスト依存は不要です。

Bunを使う場合、ルートで次を実行します。

```sh
bun -e 'Bun.serve({hostname:"127.0.0.1",port:18763,fetch:request=>new Response(Bun.file(new URL(request.url).pathname.slice(1)))});'
```

`http://127.0.0.1:18763/test/browser/selection-replacement.html` を開いてください。翻訳APIは呼び出さず、原文と訳文のDOM反映・復元を検証します。注釈の余白は `/test/browser/selection-popup.html` で確認できます。API呼び出しと設定のテストは `bun run test` に含まれます。

`/test/browser/selection-model.html` は、LM StudioのOrnith 1.5 9B（推論low）から取得した保存済み出力を使い、リンクの語順変更・リンク先の保持・原文復元を確認するページです。モデルへの再リクエストは行いません。

`/test/browser/selection-summary.html` は、ストリームイベントを模擬して選択要約の初回と長さ調整の途中表示・失敗時の結果復元と再試行・閉じた後の遅延応答を確認します。成功時のタイトルは `PASS 選択要約テスト` です。実モデルの要約品質は、拡張と対象ページを再読み込みし、文章を選択 →「LLM要約」→「短く」「長く」で確認してください。

## OpenAI互換の接続設定

拡張を再読み込みし、設定画面で以下を確認します。

- 旧設定の接続先・URL・モデル・推論設定が選択され、別のプリセットへ切り替えて戻しても保持される。
- URLを変更するとその接続先のAPIキーがクリアされ、他のプリセットのキーには影響しない。
- モデルIDを手入力してEnterで確定し、「動作確認」で保存前の接続先に翻訳を送れる。
- 保存して設定画面を開き直しても値が残り、ページ内の翻訳にも反映される。
- 一覧取得に失敗してもモデルIDを手入力でき、取得中にプリセットを切り替えても遅い応答で上書きされない。

接続設定の移行・URL検証・リクエスト形式・対応機能は `bun run test` に含まれます。

## ストリーム表示

`/test/browser/streaming-display.html` は、画像ポップアップの途中表示、選択置換とページ翻訳のプレビュー、原文の保持、遅延通知の無視を実DOMで確認します。成功時のタイトルは `PASS ストリーム表示テスト` です。翻訳APIは呼び出しません。

設計方針と共通APIの使い分けは [ストリーム表示の方針](../../docs/streaming.md) を参照してください。

`/test/browser/nano-live.html` は通常のWebページから内蔵Nanoを呼び、テキスト・画像・構造化バッチの差分数と最終結果を表示します。モデルが利用可能な場合だけボタンを有効にし、ダウンロードは開始しません。拡張の読み込み状態や権限とは別の、実モデルのスモークテストです。


`/test/browser/nano-preparation.html` はモデルAPIを模擬し、実際の準備UIで初回案内・画像非対応・進捗・中止・再試行・遅延完了時の解放を確認します。成功時のタイトルは `PASS Nano 準備画面テスト` です。実際の初回ダウンロードは、拡張を再読み込みして設定の「モデルを準備」から確認してください。

`/test/browser/selection-conversation.html` は、選択翻訳後の追加指示、複数ターン、途中表示、失敗時の回答と入力の復元、閉じた後の遅延応答を確認します。成功時のタイトルは `PASS 選択翻訳の会話テスト` です。APIの回答は模擬しています。
