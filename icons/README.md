# アイコンファイルについて

Chrome 拡張で使用する PNG アイコンは同梱済みです。

- `icon16.png`
- `icon48.png`
- `icon128.png`

デザインは「文」の吹き出しと、AIを表すミント色の四芒星です。
`icon.svg` を正本とし、文字もパスで描いているためフォントに依存しません。

PNGを再生成する場合のみ、Node.jsとsharpが必要です。
通常の拡張機能の利用にこれらは不要です。
既存のsharpを使う場合は、その`node_modules`を`NODE_PATH`に指定して実行できます。

```sh
NODE_PATH=/path/to/node_modules bash scripts/create_icons.sh
```

変換用のsharpを別途用意する場合は、一時ディレクトリにインストールできます。

```sh
icon_tools=$(mktemp -d)
npm install --prefix "$icon_tools" --no-package-lock --no-audit --no-fund sharp
NODE_PATH="$icon_tools/node_modules" bash scripts/create_icons.sh
```

スクリプトはSVGを変更せず、透過を維持して16・48・128pxのPNGを生成します。
