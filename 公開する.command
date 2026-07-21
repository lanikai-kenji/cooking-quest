#!/bin/bash
# ============================================================
#  発表ページ(present.html)を インターネットに公開/更新する
#  （GitHub Pages へアップロードします）
#  つかい方:
#   1) アプリの「⚙️せってい → 🌐発表ページを公開用に書き出す」を押す
#      → present.html が ダウンロードフォルダ に保存されます
#   2) この「公開する.command」をダブルクリック
#   3) 数分で下のURLに反映されます
# ============================================================
cd "$(dirname "$0")" || exit 1

PAGES_URL="https://lanikai-kenji.github.io/cooking-quest/present.html"

# 最新の present.html を Downloads からさがす（present(1).html なども対象）
SRC=""
for f in "$HOME/Downloads/present.html" "$HOME/Downloads/present"*.html; do
  [ -f "$f" ] || continue
  if [ -z "$SRC" ] || [ "$f" -nt "$SRC" ]; then SRC="$f"; fi
done

if [ -z "$SRC" ]; then
  echo "⚠️ ダウンロードフォルダに present.html が見つかりませんでした。"
  echo "   先にアプリの「せってい → 発表ページを公開用に書き出す」で"
  echo "   present.html を保存してから、もう一度このファイルを開いてください。"
  read -r -p "エンターキーでとじます..." _; exit 1
fi

echo "みつけた発表ファイル: $SRC"
cp "$SRC" ./present.html

git add present.html >/dev/null 2>&1
if git commit -m "発表ページを公開/更新" >/dev/null 2>&1; then
  git push
  echo ""
  echo "======================================================"
  echo " ✅ 公開しました！ 数分でこちらに反映されます:"
  echo "    ${PAGES_URL}"
  echo "======================================================"
else
  echo "（前回と同じ内容のため、更新はありませんでした）"
fi
read -r -p "エンターキーでとじます..." _
