---
name: swap-do-container
description: o getdemo-dev tem 7 GiB de RAM e 14 GiB de swap pelo raw.lxc; mudar limits.memory ao vivo devolve o swap ao tamanho da RAM
metadata:
  type: reference
---

O container LXD `getdemo-dev` tem 7 GiB de RAM (`limits.memory`) e 14 GiB de swap. O swap vem de dois swapfiles de 8G na VM da Oracle, `/swapfile` e `/swapfile2`, os dois no `/etc/fstab`. O Coolify da produção divide esse swap.

O LXD 5.21 não tem chave para o tamanho do swap. Ele põe o `memory.swap.max` igual ao `limits.memory`. O limite de 14 GiB mora no `raw.lxc` do container, ao lado do peso de CPU:

    lxc.cgroup2.cpu.weight = 20
    lxc.cgroup2.memory.swap.max = 15032385536

Num container descartável, o `raw.lxc` valeu no boot e no restart. Já um `lxc config set ... limits.memory=` com o container ligado devolveu o `memory.swap.max` ao tamanho da RAM na hora. Mudou a RAM? Grave de novo o swap ao vivo, na VM, sem reiniciar:

    echo 15032385536 | sudo tee /sys/fs/cgroup/lxc.payload.getdemo-dev/memory.swap.max

Dentro do container, a `agentes.slice` pode usar 8G desse swap (`MemorySwapMax`). Os limites de cada serviço de sessão estão na tabela "Memória desta VPS" do CLAUDE.md global. Decidido pelo João em 15/10/2026, com a condição de não afetar a produção.
