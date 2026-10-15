# Getdemo

Pasta do trabalho do João na Getdemo. A sessão aberta aqui atende a empresa inteira: os projetos de
código, os dados da empresa e o trabalho que não é código.

## Os projetos

| pasta | o que é |
| :--- | :--- |
| `zippi-datawarehouse/` | A V2, em monorepo. O warehouse ingere HubSpot e Conta Azul e produz a Gold, e o BI lê a Gold. Repo `zippi-brtech/zippi-datawarehouse`, em produção no Coolify da Oracle |
| `bi-financeiro-getdemo/` | O BI V1, congelado em manutenção. Serve para conferir o número da V2 |
| `get-demo-datalake-pipeline/` | O data lake V1, congelado em manutenção. Serve para conferir o número da V2 |
| `spec-agentes/` | A pesquisa e as decisões de agosto de 2026 que levaram à V2. Registro parado, fora do git |
| `relatorios/` | A auditoria das 582 colunas da Gold, em HTML, com os dados que a geraram |
| `hubspot/` | A configuração do HubSpot: propriedades, produtos, workflows, pipelines. Todo trabalho que lê ou muda a configuração começa no `CLAUDE.md` de lá, que tem a regra de escrita |

Cada repo tem o próprio `CLAUDE.md`, e ele vale quando você mexe em arquivo de lá.

Leia o `zippi-datawarehouse` à vontade daqui. Para mudar código nele, peça ao João para abrir a
sessão no ambiente `zippi-datawarehouse` do Remote Control: aberta lá, a sessão carrega a memória,
os hooks e as permissões do repo, que uma sessão aberta aqui não carrega.

## As fontes

Os dados da empresa chegam pelos conectores do claude.ai: HubSpot, Warehouse Getdemo, Slack, Gmail,
Google Calendar, Google Drive, Notion, Salesbud, Apollo e Lusha.

Ler das fontes é livre. Escrever nelas pede um pedido explícito do João na conversa: mensagem no
Slack, e-mail, registro no HubSpot, evento na agenda, página no Notion. Sem esse pedido, deixe em
rascunho e mostre a ele.

## A memória

A memória desta pasta mora em `~/.claude/projects/-home-sv-getdemo/memory/`. Salve nela o que o João
explicar sobre a rotina, as pessoas, os clientes e as tarefas que se repetem, para ele não explicar
de novo.
