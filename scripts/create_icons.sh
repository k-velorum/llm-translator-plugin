#!/bin/bash

# iconsディレクトリを作成
mkdir -p icons

# SVGアイコンの内容（LのM乗のようなデザイン）
cat > icons/icon.svg << 'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景円 -->
  <circle cx="64" cy="64" r="60" fill="#4285f4"/>
  
  <!-- 「L」の文字 -->
  <path d="M 40,30 L 40,90 L 85,90 L 85,75 L 55,75 L 55,30 Z" 
        fill="white" 
        stroke="white" 
        stroke-width="2"/>
  
  <!-- 右上に小さな「M」の文字（L乗のような表現） -->
  <path d="M 75,35 L 85,35 L 95,50 L 105,35 L 115,35 L 115,60 L 105,60 L 105,45 L 95,60 L 85,45 L 85,60 L 75,60 Z" 
        fill="white" 
        stroke="white" 
        stroke-width="1.5"
        transform="scale(0.7) translate(30, -10)"/>
</svg>
EOF

echo "SVGアイコンを作成しました: icons/icon.svg"
echo "注意: このSVGファイルをもとに、以下のサイズのPNGファイルを作成する必要があります:"
echo "- icons/icon16.png (16x16)"
echo "- icons/icon48.png (48x48)"
echo "- icons/icon128.png (128x128)"

# ユーザーに指示を表示
cat << 'EOF'
SVGからPNGへの変換には、以下のツールを使用できます:
- Inkscapeコマンドライン: inkscape icons/icon.svg --export-png=icons/icon128.png --export-width=128 --export-height=128
- ImageMagick: convert icons/icon.svg -resize 128x128 icons/icon128.png
- オンラインサービス: SVGをアップロードしてPNGにエクスポート
EOF