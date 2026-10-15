---
name: onde-ficam-as-credenciais
description: Regra de 14/10/2026 para onde cada credencial mora na VPS; nada de .env.<serviço> avulso
metadata:
  type: feedback
---

Decidido pelo João em 14/10/2026: um arquivo por escopo, uma seção comentada por serviço dentro dele, nunca um `.env.<serviço>` novo.

- credencial só do warehouse: `~/getdemo/zippi-datawarehouse/apps/warehouse/.env`
- credencial só do BI: `apps/bi/.env` (Pluggy e Conta Azul sandbox estão lá)
- compartilhada entre warehouse e BI: `.env` da raiz do zippi-datawarehouse
- da Getdemo e fora do zippi (Vaultwarden do agente): `~/getdemo/.env`
- `~/.secrets`: só o que o shell do João carrega ao abrir; o João quer tirar do chezmoi

**Why:** os arquivos avulsos (`.env.bw-agente`, `.env.nekt*`) se espalharam e ninguém sabia o que estava onde.

**How to apply:** credencial nova entra como seção no arquivo do escopo, com prefixo do serviço (`PLUGGY_*`, `CONTA_AZUL_SANDBOX_*`). Escreva o nome da variável vazio e deixe o João preencher pelo SSH. Backup antes de mexer: `yarn env exportar`. Ver [[cofre-credenciais-agentes]].
