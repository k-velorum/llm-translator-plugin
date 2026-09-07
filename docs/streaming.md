# ストリーム表示の方針

表示はストリームを基本とし、取得方式の選択は background の共通APIが担当する。content はプロバイダー名や通信プロトコルで分岐しない。

- テキスト・要約は `translateTextStream`、画像は `translateImageStream` を使う。対応プロバイダーは差分を返し、非対応または接続設定でOFFの場合は一括結果を同じ更新・完了イベントで返す。
- `translateText` / `translateBatchStructured` は、`requestOptions.onDelta` が渡された場合にストリームを選ぶ。コールバックなしの一括取得は、動作確認や表示先が使えない場合のために残す。
- 差分コールバックは `onDelta(deltaText, fullText)`。戻り値が最終結果で、成功時のみ表示を確定する。キャンセルとタイムアウトは実行中のAPIまで伝え、リスナーとモデルセッションを解放する。
- OpenAI互換のSSEとNanoの `promptStreaming()` は同じ表示イベントに変換する。Nanoに `promptStreaming` がない場合、または互換サーバーが通常JSONで応答した場合は、その場で一括処理する。
- 通信途中の失敗を一括取得で再送しない。構造化出力の形式切り替え・ページ翻訳の分割再試行は既存の方針と時間予算に従う。

選択翻訳と画像翻訳は `streamToPopup` が表示・キャンセルを管理する。X・YouTube・要約は共通の開始メッセージを使う。開始・差分・完了・エラー・キャンセルの各イベントは requestId で対応付ける。

ページ翻訳のJSONと選択置換のHTMLは、生成中にはテキストとしてプレビューする。未確定出力をDOMへ挿入しない。最終結果を既存のID・構造検証に通してから本文へ反映し、停止・再実行・完了後に届いたプレビューは無視する。

検証は `bun run test` と `test/browser/streaming-display.html`、既存の要約・選択置換ブラウザテストを使う。Nanoの通信テストでは offscreen と background のメッセージ経路を通し、途中表示・中断・解放を確認する。実モデルの品質と端末ごとの利用可否は別途確認する。
