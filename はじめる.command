#!/bin/bash
# ============================================================
#  クッキングクエスト を かくじつに起動するランチャー（Mac用）
#  ※ このファイルを「ダブルクリック」するだけでOK
#  ・写真がきちんと保存される「サーバーモード」で開きます
#  ・ウィンドウ（黒い画面）は開いている間はそのままにしてね
#    （閉じると保存サーバーも止まります）
# ============================================================

# このスクリプトがある場所へ移動
cd "$(dirname "$0")" || exit 1

PORT=8123
# 使えるポートをさがす（ふさがっていたら +1）
for p in 8123 8124 8125 8126 8127; do
  if ! lsof -i :"$p" >/dev/null 2>&1; then PORT=$p; break; fi
done

URL="http://localhost:${PORT}/index.html"

echo "======================================================"
echo "  🔥 クッキングクエスト を起動します"
echo "  ブラウザで次のページが開きます:"
echo "     ${URL}"
echo ""
echo "  ※ この黒いウィンドウは開いたままにしてください。"
echo "    （とじると保存サーバーも止まります）"
echo "    おわるときは、このウィンドウで Control + C をおすか、"
echo "    ウィンドウをとじてください。"
echo "======================================================"

# 少し待ってからブラウザで開く
( sleep 1; open "$URL" ) &

# Python があればそれで、なければ Python2 で簡易サーバーを起動
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m SimpleHTTPServer "$PORT"
else
  echo "Python が見つかりませんでした。"
  echo "かわりに index.html をブラウザで直接ひらきます。"
  open "index.html"
  read -r -p "エンターキーでとじます..." _
fi
