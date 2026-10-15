---
name: hubspot-itens-de-linha
description: "Frente de trocar a propriedade Produtos do deal por itens de linha no HubSpot, aberta em 08/10/2026; mora em ~/getdemo/hubspot"
metadata:
  node_type: memory
  type: project
  originSessionId: b951ff3f-fd3f-5a89-967b-ffeaa002fc8f
  modified: 2026-10-13T19:34:58.252Z
---

Em 08/10/2026 o João pediu para os vendedores lançarem o produto como item de linha, no lugar da multisseleção `produtos__pos_vendas_`, para saber quanto do MRR do deal vem de cada produto. Ele pediu auditoria antes de qualquer mudança e "MUITO cuidado" com a escrita.

O trabalho mora em `~/getdemo/hubspot/`, criada para isso e para toda mexida futura no HubSpot. O estado e o que falta ficam em `auditoria/2026-10-08-itens-de-linha.md`. A pasta tem plano aprovado, `escrever.sh` e regras de bloqueio em `~/getdemo/.claude/settings.json`, fora do repo `claude-devcontainer` a pedido do João, que não quer misturar os dois. A chave de serviço fica em `~/getdemo/hubspot/.chave`.

O João entra no HubSpot com o Google e 2FA, então o navegador sem tela não loga. O que só muda na tela, ele faz, se eu der o passo a passo. Ele acessa a VPS pelo Mac mini com a chave `macmini`, passando pelo vps1 (`ssh getdemo` no `~/.ssh/config` dele, que faz `ProxyJump` em ubuntu@140.238.182.181 até sv@192.168.200.10). A chave `getdemo-notebook` ficou órfã com o reset do notebook em 13/10/2026.

Estado em 08/10/2026: fase 1 no ar (produto e MRR em item de linha, escopo e "Produtos" como hoje; workflow 1898636985 cobra item de linha). A fase 2, escopo no item de linha, espera a diretoria decidir quais dos 19 campos ficam, por causa do limite de 40 calculadas. O João não sobe plano do HubSpot e não aceita script externo rodando para o HubSpot: só recurso nativo. Workflow de deal não abre pela API, então ele se mexe pelo Claude do Chrome do João, com texto que eu escrevo.

Ponto focal, decidido em 13/10/2026: só o contato associado com o rótulo "Ponto Focal" vale daqui para frente. A propriedade "Email - Ponto focal" fica para o histórico e não entra em regra nova.

**Why:** a troca mexe no processo de vendas e em duas regras da V2 (o slide de produtos do MBR e o MRR por produto da tela executiva).
**How to apply:** comece toda tarefa de HubSpot lendo `~/getdemo/hubspot/CLAUDE.md` e a auditoria da frente.


Quality check no ar desde 14/10/2026: etapa entre Close e Win, workflow 1902195043 posta checklist no #quality-check, só superadmin tira o deal de lá. Estado e decisões em `~/getdemo/hubspot/planos/2026-10-08-quality-check.md`. A ação de Slack do HubSpot aceita HubL; `in` só funciona com `|string` no campo de caixas de seleção.
