#!/data/data/com.termux/files/usr/bin/bash
# Instala o claude-tab no Termux do Galaxy Tab S10.
#
#   pkg install -y git
#   git clone https://github.com/arthurpsdm-droid/omniroute ~/claude-tab
#   bash ~/claude-tab/termux/instalar.sh
#
# O script pode ser rodado de novo sem problemas (atualiza o que já existe).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
CONFIG_DIR="$HOME/.config/claude-tab"

passo() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m(!) %s\033[0m\n' "$*"; }

if [ ! -d /data/data/com.termux ]; then
  echo "Este instalador é para o app Termux no Android (rode-o no tablet)."
  exit 1
fi

passo "1/7 Atualizando pacotes do Termux"
pkg update -y
pkg upgrade -y

passo "2/7 Instalando Node.js, Termux:API, ImageMagick e git"
pkg install -y nodejs-lts termux-api imagemagick git

passo "3/7 Acesso ao armazenamento interno (capturas de tela, notas, fotos)"
if [ ! -d "$HOME/storage/shared" ]; then
  echo "Vai aparecer um pedido de permissão: toque em Permitir."
  termux-setup-storage || true
  sleep 4
fi
[ -d "$HOME/storage/shared" ] || aviso "Sem acesso ao armazenamento ainda. Rode 'termux-setup-storage' depois."

passo "4/7 Instalando as dependências do claude-tab"
cd "$REPO"
npm install --omit=dev --no-fund --no-audit

passo "5/7 Criando os comandos claude-tab e claude-tab-mcp"
for nome in claude-tab claude-tab-mcp; do
  cat > "$PREFIX/bin/$nome" <<EOF
#!$PREFIX/bin/sh
exec "$PREFIX/bin/node" "$REPO/bin/$nome.mjs" "\$@"
EOF
  chmod 755 "$PREFIX/bin/$nome"
done

passo "6/7 Atalhos da tela inicial (Termux:Widget) e menu Compartilhar"
mkdir -p "$HOME/.shortcuts/tasks" "$HOME/bin"
chmod 700 "$HOME/.shortcuts" "$HOME/.shortcuts/tasks"
for f in "$REPO"/termux/atalhos/*.sh; do
  nome="$(basename "$f" .sh)"
  case "$nome" in
    "Claude Voz"|"Claude Code"|"Claude Estudo"|"Claude Estudo Voz")
      destino="$HOME/.shortcuts/$nome" ;;                                     # abrem o terminal
    *) destino="$HOME/.shortcuts/tasks/$nome" ;;                              # rodam em segundo plano
  esac
  install -m 700 "$f" "$destino"
done
install -m 700 "$REPO/termux/compartilhar/termux-url-opener" "$HOME/bin/termux-url-opener"
install -m 700 "$REPO/termux/compartilhar/termux-file-editor" "$HOME/bin/termux-file-editor"

passo "7/7 Chave da API do Claude"
mkdir -p "$CONFIG_DIR" && chmod 700 "$CONFIG_DIR"
if [ -f "$CONFIG_DIR/env" ] && grep -q '^ANTHROPIC_API_KEY=' "$CONFIG_DIR/env"; then
  echo "Chave já configurada em $CONFIG_DIR/env."
else
  claude-tab configurar || aviso "Configure depois com: claude-tab configurar"
fi

passo "Pronto! Conferindo a instalação"
claude-tab diagnostico || true

cat <<'EOF'

Próximos passos:
  • Instale os apps Termux:API e Termux:Widget (mesma loja do Termux, ex.: F-Droid).
  • Configurações > Apps > Termux:API > Permissões: Microfone, Câmera, Localização.
  • Tela inicial: toque e segure > Widgets > Termux:Widget > arraste para a tela.
  • Teste:  claude-tab perguntar "Oi! Qual a bateria do tablet?"
  • Voz:    claude-tab voz
  • Estudo: claude-tab estudo --escutar   (diga "Claude, …" enquanto estuda)
  • Sem custo por resposta (assinatura Pro/Max/Ultra): claude-tab usar-assinatura
  • Guia completo: docs/02-integracao-claude.md
EOF
