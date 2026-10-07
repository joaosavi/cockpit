---
name: acesso-coolify
description: Como acessar o Coolify (coolify.joaosavi.cloud) por SSH e mexer direto no banco dele
metadata:
  node_type: memory
  type: reference
  originSessionId: 52226165-b593-51b7-8c43-34f8c1446bde
  modified: 2026-10-07T03:39:25.392Z
---

O Coolify (painel em https://coolify.joaosavi.cloud, IP 140.238.182.181) roda no host Oracle, que é o mesmo onde roda o zippi-datawarehouse em produção. No Coolify, esse servidor aparece com o nome "localhost".

- SSH: `ssh oracle` (192.168.200.1, usuário `ubuntu`, chave `~/.ssh/id_ed25519_oracle`, configurado no `~/.ssh/config`). Docker pede `sudo`.
- Containers: `coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`, `coolify-proxy` (o Traefik) e `coolify-sentinel`.
- Banco: `sudo docker exec -i coolify-db psql -U coolify -d coolify`. Uma mudança feita no banco vale na hora, sem reiniciar o Coolify.
- Notificações: as tabelas `*_notification_settings` (email, discord, telegram, slack, pushover, webhook) têm uma coluna booleana por evento, no formato `<evento>_<canal>_notifications`. Em 2026-10-07, desliguei `traefik_outdated_*` nos 6 canais porque o João não queria mais o aviso de Traefik desatualizado. Um evento também pode ser desligado pelo painel, em Notifications.

Para o acesso pelo navegador, ver [[cofre-credenciais-agentes]].
