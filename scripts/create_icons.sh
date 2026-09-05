#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# SVGを正本として扱い、PNGの再生成でデザインを上書きしない。
node - "$repo_root" <<'JS'
const path = require('node:path');
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('PNGの生成にはNode.jsとsharpが必要です。icons/README.mdを参照してください。');
  process.exit(1);
}

async function main() {
  const iconDir = path.join(process.argv[2], 'icons');
  for (const size of [16, 48, 128]) {
    const output = path.join(iconDir, `icon${size}.png`);
    await sharp(path.join(iconDir, 'icon.svg'), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(output);
    console.log(`生成しました: ${output}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
JS
