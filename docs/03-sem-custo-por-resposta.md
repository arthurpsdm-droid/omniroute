# Sem custo por resposta

Este documento tem duas partes. O **estudo** explica de onde vem o custo de cada resposta, que alternativas existem e quais são permitidas. O **guia** mostra, passo a passo, como deixar o claude-tab sem cobrança por resposta.

---

## Parte 1: o estudo

### De onde vem o custo por resposta

Até aqui, o claude-tab falava com o Claude pela **API da Anthropic**, usando uma chave criada no Console. A API cobra **por uso**: cada pergunta envia alguns milhares de tokens (as instruções, a lista de ferramentas e a sua pergunta) e recebe algumas centenas. Isso dá centavos de dólar por resposta, cobrados na conta da API.

A Anthropic vende o Claude de duas formas:

| | API (Console) | Plano (Free, Pro, Max, Ultra) |
|---|---|---|
| Como paga | Por uso, a cada resposta | Valor fixo por mês (Free: zero) |
| Onde se usa | Programas próprios, com chave de API | App do Claude, site e **Claude Code** |
| Limite | O quanto você pagar | Limites de uso do plano, renovados periodicamente |

Para acabar com o custo por resposta, a ideia é fazer o claude-tab usar o **plano** em vez da API.

### O que os termos permitem

A página *Legal and compliance* do Claude Code define as regras:

- **Permitido:** entrar no **programa Claude Code oficial, sem modificações**, com a **sua própria** assinatura. O modo não interativo (`claude -p`) faz parte do Claude Code e é documentado pela Anthropic.
- **Permitido, com uma condição:** os limites anunciados dos planos Pro, Max e Ultra "pressupõem uso individual e comum do Claude Code". É o caso de um assistente pessoal no seu tablet.
- **Proibido:**
  - usar o login de uma assinatura em outros produtos ou ferramentas;
  - copiar, guardar ou repassar o token de login do Claude;
  - oferecer o login do Claude.ai dentro de um app de terceiros;
  - atender outras pessoas com o seu plano.

A Anthropic passou a **bloquear** ferramentas de terceiros que usavam o login de assinaturas. Isso começou em janeiro de 2026, foi formalizado em fevereiro e virou bloqueio total em abril. Contas que insistem nisso podem ser suspensas.

**Por isso, a solução escolhida não toca no seu login.** O claude-tab apenas chama o programa `claude` oficial, que você instalou e no qual você mesmo entrou. O token nunca é lido nem copiado. Antes de chamar o Claude Code, o claude-tab também remove a chave da API do ambiente, para garantir que ele use a assinatura.

### As opções comparadas

| Caminho | Custo por resposta | Custo fixo | Claude age no tablet? | Limite |
|---|---|---|---|---|
| **A. claude-tab pela assinatura (Claude Code)** | **zero** | Pro: US$ 20/mês (US$ 17 no plano anual) | sim | Limites do plano |
| **B. claude-tab com os créditos de API do Max/Ultra** | **zero** até o crédito acabar | Max: US$ 100/mês · Ultra: US$ 200/mês | sim | US$ 100 (Max) ou US$ 200 (Ultra) de API por mês. Ao acabar, as respostas param até o mês seguinte; nada é cobrado no plano |
| **C. Comandos locais** (já incluídos no claude-tab) | **zero**, nem chama o Claude | nenhum | sim, para brilho, volume, lanterna, bateria e Wi-Fi | nenhum |
| **D. Só o app oficial, plano Free** | **zero** | nenhum | não (só agenda, alarmes e o resto do app) | Limite de mensagens do Free |
| API comum (como era antes) | centavos | nenhum | sim | o quanto você pagar |

Observações:

- O plano **Free não inclui o Claude Code**, então o caminho A pede no mínimo o **Pro**.
- Os créditos mensais de API do caminho B existem **só no Max e no Ultra**. O Pro não tem.
- No caminho A, o uso do claude-tab entra no mesmo limite do plano que você usa no app do Claude e no Claude Code.

### Conclusão

A combinação recomendada é **A + C**:

- **C (comandos locais):** pedidos simples ao tablet são resolvidos no próprio aparelho, sem custo e sem gastar limite.
- **A (assinatura):** todo o resto vai para o Claude Code logado no seu plano Pro, sem cobrança por resposta.

Quem já tem **Max ou Ultra** pode usar o caminho A ou o B. Com o B, o claude-tab continua usando a API, mas paga com o crédito que já vem no plano.

---

## Parte 2: o guia

### Caminho A: claude-tab pela sua assinatura (recomendado)

**Pré-requisito:** plano **Pro, Max ou Ultra** em [claude.com/pricing](https://claude.com/pricing).

1. **Instale o Claude Code no Ubuntu do Termux** (é o mesmo passo do nível 4 do guia de integração):

   ```bash
   pkg install -y proot-distro
   proot-distro install ubuntu
   proot-distro login ubuntu
   # dentro do Ubuntu:
   apt update && apt install -y curl git
   curl -fsSL https://claude.ai/install.sh | bash
   claude
   ```

2. **Entre com a conta do Claude, a da assinatura.** Quando o `claude` perguntar como entrar, escolha a **conta do Claude (Pro/Max/Ultra)**, não a "Anthropic Console". A conta do Console cobra por uso, que é justamente o que queremos evitar. Depois de entrar, saia com `/exit` e depois `exit`.

3. **Atualize o claude-tab** (no Termux):

   ```bash
   cd ~/claude-tab && git pull && bash termux/instalar.sh
   ```

4. **Mude para a assinatura:**

   ```bash
   claude-tab usar-assinatura
   ```

   O comando:
   - encontra o Claude Code;
   - faz uma pergunta de teste pela sua assinatura;
   - só então grava a escolha.

   Se algo faltar, ele diz o que fazer.

5. **Confira:**

   ```bash
   claude-tab diagnostico
   ```

   Deve aparecer: `Modo de cobrança: assinatura (Claude Code): sem custo por resposta, usa os limites do seu plano`.

6. **Garanta que nada vá para a API.** Se não pretende mais usar a API, apague a chave em *console.anthropic.com › API Keys* e tire a linha `ANTHROPIC_API_KEY=` de `~/.config/claude-tab/env`. Se preferir mantê-la de reserva, defina um limite de gasto baixo no Console.

A partir daqui, **todos os atalhos usam a assinatura**: Claude Voz, Tela, Copiado, Pergunta, menu Compartilhar e modo estudo. Para voltar à API: `claude-tab usar-api`.

**O que muda no uso:**

- **Velocidade:** cada resposta demora alguns segundos a mais, porque o Claude Code é iniciado dentro do Ubuntu a cada pergunta. Para conversas por voz, os comandos locais compensam boa parte disso.
- **Limite:** se o limite do plano acabar, o claude-tab avisa ("limite de uso do seu plano") e volta a funcionar quando o limite se renova. Não há cobrança extra, a menos que você tenha ligado o uso extra pago no app do Claude.
- **Ações sensíveis:** continuam pedindo confirmação na tela do tablet (ou com a sua digital).
- **Bloqueios de segurança:** o Claude Code fica proibido de rodar comandos no terminal e de editar arquivos. Ele só pode usar as ferramentas do tablet, ler os anexos que você mandar e pesquisar na web.

### Caminho B: créditos mensais de API do Max ou Ultra

1. No app do Claude, abra a parte de **créditos mensais de API** do plano e **vincule a uma organização do Console**. O artigo da central de ajuda "Monthly API credits for Max, Ultra, and Team plans" mostra onde fica.
2. No Console, crie uma **chave de API** nessa organização.
3. No Termux: `claude-tab configurar`, cole a chave e depois `claude-tab usar-api`.

As respostas passam a ser pagas pelo crédito do plano: US$ 100 por mês no Max e US$ 200 no Ultra. Se o crédito acabar e a organização não tiver outros créditos, **as respostas param até o mês seguinte**. O plano nunca é cobrado por isso.

### Caminho C: comandos locais (já ligados)

Estas frases são resolvidas no próprio tablet, **sem chamar o Claude**. Funcionam na voz (Claude Voz) e no modo estudo:

| Você diz | O tablet faz |
|---|---|
| "abaixa o brilho para 30 por cento", "brilho no máximo", "deixa o brilho automático" | ajusta o brilho |
| "volume 40", "coloca o volume no mínimo", "silencia" | ajusta o volume da mídia |
| "liga a lanterna", "desliga a lanterna" | lanterna |
| "qual a bateria?", "como tá a bateria?" | lê a bateria em voz alta |
| "em que Wi-Fi eu estou?" | diz o nome da rede |

Perguntas de verdade ("o que é brilho em física?") continuam indo para o Claude. Para desligar os comandos locais, use `CLAUDE_TAB_COMANDOS_LOCAIS=0`.

### Caminho D: custo zero absoluto

No plano **Free**, o app oficial do Claude não custa nada (com limite de mensagens). Use os níveis 1 e 2 do guia de integração e os comandos locais do claude-tab. O Claude não age no tablet nesse caso, porque o Free não inclui o Claude Code e a API é paga.

---

## O que NÃO fazer

- Não use apps, "proxies" ou extensões que prometem "Claude grátis" ou "usar sua assinatura em qualquer lugar". Eles reaproveitam o login do Claude, o que os termos proíbem e a Anthropic bloqueia.
- Não copie o token de `~/.claude` para outros programas.
- Não compartilhe a sua conta nem use o claude-tab para atender outras pessoas com o seu plano.

---

## Perguntas frequentes

**O `total_cost_usd` que o Claude Code mostra é cobrado?**
Não, quando você está logado com a assinatura. É uma estimativa do que aquele uso custaria na API.

**Posso ter as duas coisas, assinatura e API?**
Pode. `claude-tab usar-assinatura` e `claude-tab usar-api` alternam entre elas. O arquivo `~/.config/claude-tab/env` guarda a escolha.

**E se o Claude Code dentro do Ubuntu tiver uma `ANTHROPIC_API_KEY` no `.bashrc`?**
O claude-tab remove a variável antes de chamar o `claude`, então a assinatura continua sendo usada.

---

## Fontes

- Anthropic, Claude Code: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) · [Modo não interativo (headless)](https://code.claude.com/docs/en/headless) · [Custos](https://code.claude.com/docs/en/costs)
- Anthropic: [Planos e preços](https://claude.com/pricing) · [Créditos mensais de API do Max, Ultra e Team](https://support.claude.com/en/articles/17154008) · [Uso extra nos planos pagos](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans)
- Bloqueio de ferramentas de terceiros: [The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access) · [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/) · [Bloqueio do OpenClaw](https://pasqualepillitteri.it/en/news/642/anthropic-blocks-openclaw-third-party-tools-claude-subscriptions)
