#!/bin/bash
# Cronômetro Sync — dê dois cliques para iniciar (Mac).
cd "$(dirname "$0")" || exit 1

# Opened from the Finder the shell profile is not loaded: look in the usual places too.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  for dir in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.volta/bin; do
    [ -x "$dir/node" ] && PATH="$dir:$PATH"
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Falta instalar o Node.js neste Mac (só uma vez)."
  echo "  Vou abrir o site: baixe a versão LTS, instale e depois"
  echo "  dê dois cliques neste arquivo de novo."
  echo
  open "https://nodejs.org/pt-br/download"
  read -r -p "  Pressione Enter para fechar... " _
  exit 1
fi

node server.js --abrir
