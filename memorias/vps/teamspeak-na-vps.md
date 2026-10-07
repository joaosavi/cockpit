---
name: teamspeak-na-vps
description: "TS6 da galera do João no Coolify da VPS da Oracle, em ts.joaosavi.cloud; como administrar por ServerQuery e o bot de AFK"
metadata:
  node_type: memory
  type: project
  originSessionId: e91abdb6-76f8-5ced-ae86-997d87d521d1
  modified: 2026-10-07T00:24:27.168Z
---

Montado em 06/10/2026, a pedido do João, para a galera dele compartilhar tela. Não é trabalho da ESAG.

- Coolify da VPS (`ssh oracle`), projeto `teamspeak`, serviço `arvdm3s2m8it8effeuq7otj7`, com dois containers: `teamspeak` (imagem `teamspeaksystems/teamspeak6-server:latest`, só a 9987/UDP publicada) e `afk` (alpine, `network_mode: service:teamspeak`, move para o canal AFK quem passa 20 min parado)
- O deploy é pela API do Coolify na porta 8000 do host, com o `COOLIFY_TOKEN` do `.env` do `~/getdemo/zippi-datawarehouse`. A senha do serveradmin é a env `TS_QUERY_PASSWORD` do serviço
- Endereço `ts.joaosavi.cloud`, servidor "pesadelo da janja". A regra 9987/UDP na Security List da Oracle foi aberta pelo João
- Administração: `ssh oracle '~/tsq/q.sh'`, que lê comandos de ServerQuery do stdin e roda pelo SSH query de dentro do container, porque o allowlist só aceita 127.0.0.1. A saída do query começa cada linha com `\r`
- Cargos: Admin (sgid 6), User (7, join e move 50), Visitante (8, padrão, join 0). Os canais fora da Recepção pedem join 50, então Visitante só sai da Recepção se alguém o mover
- Bot de música "filho da peste": TS6 Roadie, no container `musica` do mesmo serviço, com casa no Geral (o João aceitou que o `!leave` não tire ele de lá). Ele não tem imagem pública: a imagem `ts6-roadie:0.27.0-sv1` é construída no host a partir de `~/roadie-img` (Dockerfile com `ROADIE_REF` e o `fallback.patch`, que faz a busca guardar 3 resultados e tocar o próximo quando o primeiro está bloqueado), com `pull_policy: never`. Teste de ponta a ponta: `sh ~/roadie-img/loop.sh "!play x|!np|!stop"`, que conecta um cliente "testador" no Geral. A limpeza do Coolify apaga imagem sem container (o `tsq` sumiu uma vez; o `q.sh` agora reconstrói). A config vem da env `ROADIE_CONFIG_B64`, e o endereço precisa de ponto (`teamspeak.:9987`), porque nome sem ponto vira consulta ao myTeamSpeak. O bot está no cargo Bot (sgid 9), que o AFK ignora
- YouTube a partir do IP da Oracle cai em "Sign in to confirm you're not a bot". Em 06/10/2026 testei WARP, PO token (bgutil) e 7 player clients, e nada passou. Só cookie de conta resolve. Desde 06/10/2026 o bot usa o cookie da conta do agente (`claudiocodigo01@gmail.com`), em `/data/youtube-cookies.txt` do volume do `musica`, passado por `--cookies` no `ytdlpExtraArgs`. Quando vencer, o João exporta de novo pela aba Network do DevTools; filtre só as linhas `.youtube.com` antes de gravar, porque a exportação dele veio com os cookies do navegador inteiro
- A licença beta vem dentro da imagem e vence em 01/12/2026. Um restart com `latest=true` no Coolify puxa a imagem nova

**Why:** o João não quer gastar tempo configurando o TS na mão.

**How to apply:** mudanças no TS saem por `q.sh` ou pela API do Coolify, e não mexa no Traefik nem nos apps da produção do warehouse.
