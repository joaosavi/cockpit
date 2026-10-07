---
name: gmail-do-agente
description: o agente tem um Gmail próprio, com a senha no Vaultwarden; uso livre, mas o Google barra login pelo navegador headless
metadata:
  type: reference
---

Criado pelo João em 06/10/2026 para o agente usar sem depender das contas dele: `claudiocodigo01@gmail.com`, conferido em 06/10/2026 pelo YouTube logado (o ditado por voz sugeria "claudeo", e está errado). A credencial está no Vaultwarden da organização "Agente Getdemo" e chega pelo MCP `navegador` como `ACCOUNTS_GOOGLE_COM_USER` e `ACCOUNTS_GOOGLE_COM_PASSWORD` (ver [[cofre-credenciais-agentes]]).

O João liberou uso à vontade: logar, pegar token, abrir sessão, sem pedir a ele.

Limites achados em 06/10/2026, na primeira tentativa (pelo YouTube do bot de música do TS, em [[teamspeak-na-vps]]):
- O Google recusa o Chromium headless do `navegador` com "Couldn't sign you in. This browser or app may not be secure", já na tela do e-mail
- O `navegador` lê o cofre só quando o MCP sobe. Item criado depois disso não existe na sessão, e o nome do segredo é digitado literalmente. Reconecte o MCP (`/mcp`) ou abra sessão nova

**Why:** o João quer que o agente tenha identidade própria para serviços de terceiros, sem expor as contas dele.

**How to apply:** para usar a conta em serviço do Google, o login por navegador automatizado não passa. O caminho é o João exportar cookie ou token de um navegador real, ou usar um fluxo OAuth com consentimento dele.
