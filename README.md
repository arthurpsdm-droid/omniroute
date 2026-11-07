# Claude + Galaxy Tab S10

Estudo completo do **Samsung Galaxy Tab S10** e uma integração que coloca o **Claude** dentro do tablet: assistente por voz que age no aparelho, menu "Compartilhar", atalhos na tela inicial e um servidor MCP para o Claude Code.

## Documentos

1. **[Estudo completo do Galaxy Tab S10](docs/01-estudo-galaxy-tab-s10.md)**: os 5 modelos da linha, ficha técnica, tela e multitarefa, S Pen, Galaxy AI, DeX, segurança, bateria, pontos de atenção e checklist inicial.
2. **[Guia de integração com o Claude](docs/02-integracao-claude.md)**: 4 níveis, do app oficial ao Claude Code com acesso ao hardware, e o **modo estudo** (chamar o Claude por voz com "Claude, …" ou escrevendo com a S Pen).

## Instalação rápida (no Termux do tablet)

```bash
pkg install -y git
git clone https://github.com/arthurpsdm-droid/omniroute ~/claude-tab
bash ~/claude-tab/termux/instalar.sh
claude-tab voz
```

Pré-requisitos: apps **Termux**, **Termux:API** e **Termux:Widget** (todos da mesma loja, ex.: F-Droid) e uma chave da API do Claude. Detalhes no [guia](docs/02-integracao-claude.md#nível-3-claude-tab-o-claude-agindo-no-tablet).

## Estrutura

```
bin/claude-tab.mjs        CLI: perguntar, voz, tela, area, compartilhado, estudo, configurar, diagnostico, mcp
bin/claude-tab-mcp.mjs    servidor MCP (stdio) para o Claude Code
src/tools.mjs             ferramentas do tablet (um catálogo para a API e para o MCP)
src/claude.mjs            conversa com o Claude (SDK oficial, tool runner, web)
src/estudo.mjs            modo estudo: notificação com botões, escuta com "Claude, …", nota da sessão
src/entrega.mjs           resposta em notificação com Copiar/Compartilhar
src/termux.mjs            execução dos comandos Termux:API com tempo limite e confirmação
src/attachments.mjs       imagens/PDF/texto → blocos da API (reduz imagens grandes)
src/device.mjs            identificação do modelo Tab S10 e versão do One UI
termux/instalar.sh        instalador para o Termux
termux/atalhos/           scripts dos widgets (Termux:Widget)
termux/compartilhar/      integração com o menu Compartilhar do Android
test/                     testes com Termux:API e API do Claude simulados
```

## Desenvolvimento

```bash
npm install
npm test        # roda sem tablet: os comandos termux-* e a API são simulados
```
