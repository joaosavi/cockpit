---
name: artifact-em-sessao-sdk
description: A ferramenta Artifact some em sessão aberta pelo claude.ai sem CLAUDE_CODE_ARTIFACT=1 no settings
metadata:
  node_type: memory
  type: reference
  originSessionId: 2c849247-4c10-5126-8467-2cdbd7e00bda
  modified: 2026-10-05T00:07:10.517Z
---

Sessão aberta pelo claude.ai roda o Claude Code como `sdk-cli`, e nesse modo o Artifact fica desligado
por padrão. Ele liga quando o processo recebe `CLAUDE_CODE_ARTIFACT=1` ou, do bridge,
`CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT=1`. Em 04/10/2026 o João pôs `CLAUDE_CODE_ARTIFACT=1` no `env` do
`~/.claude/settings.json`. A variável vale só para sessão nova.

**Why:** em 03 e 04/10/2026 o bridge deixou de mandar a variável dele, e o TCC ficou um dia sem
publicar. O classificador do modo automático recusa a edição do `settings.json` pelo Claude, mesmo com a
autorização do João no chat.

**How to apply:** se o Artifact faltar, confira o `env` do `~/.claude/settings.json` e passe ao João o
comando para ele mesmo editar. Ligado ao [[tcc-handoff]].
