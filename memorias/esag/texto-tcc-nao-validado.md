---
name: texto-tcc-nao-validado
description: O texto do TCC foi escrito pelo Claude e o João ainda não revisou; não usar o texto como fonte de fato
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4c32dd06-db8b-598b-b9ec-853a38c18815
  modified: 2026-10-05T05:37:13.454Z
---

O texto do TCC (`tcc/tcc.html`) foi escrito pelo Claude, do zero e em pouco tempo, a partir de descrições e
prompts longos do João. Em 05/10/2026 ele ainda não tinha revisado o texto, então o texto não está validado.

**Why:** em 05/10/2026, numa análise que tratou o texto como o relato do João ("o texto afirma que houve
negociação"), ele corrigiu: "não leve o texto do TCC como verdade absoluta, porque ele não foi validado ainda".
A "negociação sem autoridade formal" era uma leitura do Claude; na verdade os processos já existiam, as regras
miúdas foram definidas durante a construção e o COO validou as mudanças.

**How to apply:** ao analisar ou mudar o TCC, tire os fatos de `tcc/decisoes.md`, de `tcc/levantamento/fontes/`
ou do próprio João, nunca do texto. Ao apontar uma falha, diga "o texto diz X" como algo que o Claude escreveu e
pergunte se X é verdade antes de propor como contar X melhor. Ligado a [[tcc-handoff]].
