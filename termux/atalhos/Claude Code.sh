#!/data/data/com.termux/files/usr/bin/bash
# Abre o Claude Code (instalado no Ubuntu do proot-distro; veja docs/02-integracao-claude.md).
if command -v proot-distro >/dev/null 2>&1; then
  exec proot-distro login ubuntu -- bash -lc 'cd ~ && claude'
fi
echo "Claude Code ainda não instalado. Veja docs/02-integracao-claude.md, nível 4."
read -r -p "Enter para fechar " _
