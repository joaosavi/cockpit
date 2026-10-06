#!/usr/bin/env python3
"""Retoma as sessões do Remote Control que pararam por limite de uso da conta.

Roda pelo retomar-limite.timer. Lê os históricos das três pastas, acha a sessão cuja
última fala é o erro de limite, espera o horário de volta e manda uma mensagem nela
por um `claude -p` mensageiro, que usa SendMessage. Cada limite é retomado uma vez.
"""

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CASA = Path.home()
PROJETOS = CASA / ".claude" / "projects"
SESSOES = CASA / ".claude" / "sessions"
PASTAS = ["-home-sv-esag", "-home-sv-getdemo", "-home-sv-getdemo-zippi-datawarehouse", "-home-sv-resgate"]
ESTADO = CASA / ".local" / "state" / "retomar-limite" / "estado.json"

MARGEM = timedelta(minutes=2)
JANELA_SUBAGENTES = timedelta(hours=5)
JANELA_ATIVOS = timedelta(minutes=5)
TENTATIVAS = 3

MENSAGEM = (
    "Esta sessão parou às {hora_parada} UTC porque a conta bateu o limite de uso "
    '("{mensagem_limite}"). O limite voltou às {hora_volta} UTC. Antes de continuar, '
    "confira se foi esta sessão que gastou o limite. Nas 5 horas antes da parada ela abriu "
    "{n_subagentes} subagentes, e {n_ativos} estavam rodando na hora da parada. Se foi aqui, "
    "por exemplo por ter disparado 10 ou 15 subagentes em paralelo, não retome do mesmo jeito. "
    "Siga a tarefa sem subagentes em paralelo, com no máximo um por vez e só quando uma pesquisa "
    "exigir. Se não foi aqui, outra sessão em paralelo pode ter consumido o limite, e está tudo "
    "certo. Nos dois casos, siga com cautela de tokens: leia trechos em vez de arquivos inteiros "
    "e corte saída longa. Depois continue de onde parou. [{marca}]"
)

MENSAGEIRO = """Você é só um mensageiro. Faça isto e nada mais:
1. Use a ferramenta SendMessage com to="{nome}" e, como message, o texto entre as linhas INICIO e FIM, exatamente igual, sem mudar uma letra.
2. Se a ferramenta recusar ou não achar a sessão, não tente outro caminho.
3. Responda numa linha só: ENVIADO, ou FALHOU seguido do motivo.

INICIO
{texto}
FIM"""

RE_LIMITE = re.compile(r"resets (?P<quando>.+?)\s*\((?P<fuso>[^)]+)\)")
RE_HORA = re.compile(r"(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>am|pm)", re.I)
RE_DATA = re.compile(r"(?P<mes>[A-Z][a-z]{2})[a-z]*\.?\s+(?P<dia>\d{1,2})")
MESES = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def log(msg):
    print(msg, flush=True)


def data(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def texto_de(entrada):
    conteudo = entrada.get("message", {}).get("content")
    if isinstance(conteudo, list):
        return " ".join(p.get("text", "") for p in conteudo if isinstance(p, dict))
    return conteudo if isinstance(conteudo, str) else ""


def horario_de_volta(mensagem, parada):
    """Lê "resets 9:50am (UTC)" ou "resets Oct 7, 5pm (UTC)". Devolve (horário, lido)."""
    achado = RE_LIMITE.search(mensagem)
    hora = RE_HORA.search(achado.group("quando")) if achado else None
    if not hora:
        return parada + timedelta(hours=5), False
    try:
        fuso = ZoneInfo(achado.group("fuso").strip())
    except Exception:
        return parada + timedelta(hours=5), False
    h = int(hora.group("h")) % 12 + (12 if hora.group("ap").lower() == "pm" else 0)
    m = int(hora.group("m") or 0)
    local = parada.astimezone(fuso)
    dia = RE_DATA.search(achado.group("quando"))
    if dia and dia.group("mes") in MESES:
        volta = local.replace(month=MESES.index(dia.group("mes")) + 1, day=int(dia.group("dia")),
                              hour=h, minute=m, second=0, microsecond=0)
        if volta < local - timedelta(days=1):
            volta = volta.replace(year=volta.year + 1)
    else:
        volta = local.replace(hour=h, minute=m, second=0, microsecond=0)
        if volta <= local:
            volta += timedelta(days=1)
    return volta.astimezone(timezone.utc), True


def parada_por_limite(historico):
    """Devolve a última fala se ela for o erro de limite, ou None."""
    ultima = None
    with open(historico, encoding="utf-8", errors="replace") as f:
        for linha in f:
            try:
                e = json.loads(linha)
            except ValueError:
                continue
            if e.get("type") in ("user", "assistant") and not e.get("isSidechain"):
                ultima = e
    if ultima and ultima.get("isApiErrorMessage") and ultima.get("error") == "rate_limit":
        return ultima
    return None


def pontas(arquivo):
    """Primeiro e último timestamp de um histórico de subagente."""
    primeiro = ultimo = None
    with open(arquivo, "rb") as f:
        for linha in f:
            ts = json.loads(linha).get("timestamp") if b'"timestamp"' in linha else None
            if ts:
                primeiro = ts
                break
        f.seek(max(0, os.path.getsize(arquivo) - 65536))
        for linha in f.read().splitlines():
            try:
                ts = json.loads(linha).get("timestamp")
            except ValueError:
                continue
            ultimo = ts or ultimo
    return primeiro and data(primeiro), ultimo and data(ultimo)


def subagentes(historico, parada):
    pasta = historico.with_suffix("") / "subagents"
    abertos = ativos = 0
    for arquivo in pasta.glob("agent-*.jsonl"):
        inicio, fim = pontas(arquivo)
        if not inicio:
            continue
        if parada - JANELA_SUBAGENTES <= inicio <= parada:
            abertos += 1
        if inicio <= parada and fim and fim >= parada - JANELA_ATIVOS:
            ativos += 1
    return abertos, ativos


def detectar(projetos, pastas, agora, janela):
    for pasta in pastas:
        for historico in sorted((projetos / pasta).glob("*.jsonl")):
            idade = agora.timestamp() - historico.stat().st_mtime
            if janela and idade > janela.total_seconds():
                continue
            e = parada_por_limite(historico)
            if not e:
                continue
            parada = data(e["timestamp"])
            mensagem = texto_de(e).strip()
            volta, lido = horario_de_volta(mensagem, parada)
            abertos, ativos = subagentes(historico, parada)
            yield {
                "sessao": historico.stem, "pasta": pasta, "historico": str(historico),
                "parada": parada.isoformat(), "volta": volta.isoformat(), "volta_lida": lido,
                "mensagem_limite": mensagem, "subagentes": abertos, "ativos": ativos,
            }


def processo_vivo(sessao):
    for arquivo in SESSOES.glob("*.json"):
        try:
            s = json.loads(arquivo.read_text())
        except (ValueError, OSError):
            continue
        if s.get("sessionId") != sessao:
            continue
        try:
            inicio = Path(f"/proc/{s['pid']}/stat").read_text().rsplit(")", 1)[1].split()[19]
        except (OSError, IndexError, KeyError):
            continue
        if inicio == str(s.get("procStart")):
            return s
    return None


def entregue(historico, parada, marca):
    """A marca aparece no histórico depois da parada."""
    with open(historico, encoding="utf-8", errors="replace") as f:
        return any(marca in linha for linha in f if '"timestamp"' in linha
                   and json.loads(linha).get("timestamp", "") > parada)


def enviar(nome, texto, cwd):
    prompt = MENSAGEIRO.format(nome=nome, texto=texto)
    r = subprocess.run(
        ["claude", "-p", "--model", "haiku", "--permission-mode", "bypassPermissions",
         "--no-session-persistence", "--strict-mcp-config", "--tools", "SendMessage,ListAgents"],
        input=prompt, capture_output=True, text=True, timeout=300, cwd=cwd,
    )
    return (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1]


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--detectar", action="store_true", help="só lista, sem estado e sem mensagem")
    p.add_argument("--projetos", type=Path, default=PROJETOS)
    p.add_argument("--pasta", action="append", help="pasta de projetos, repetível")
    p.add_argument("--estado", type=Path, default=ESTADO)
    p.add_argument("--agora", help="horário ISO, para teste")
    p.add_argument("--horas", type=float, default=24, help="idade máxima do histórico, 0 = todos")
    a = p.parse_args()

    agora = data(a.agora) if a.agora else datetime.now(timezone.utc)
    janela = timedelta(hours=a.horas) if a.horas else None
    achados = list(detectar(a.projetos, a.pasta or PASTAS, agora, janela))

    if a.detectar:
        for s in achados:
            log(json.dumps(s, ensure_ascii=False))
        log(f"{len(achados)} sessões paradas por limite")
        return

    a.estado.parent.mkdir(parents=True, exist_ok=True)
    trava = open(a.estado.with_suffix(".lock"), "w")
    fcntl.flock(trava, fcntl.LOCK_EX)
    estado = json.loads(a.estado.read_text()) if a.estado.exists() else {}

    for s in achados:
        chave = f"{s['sessao']}@{s['volta']}"
        reg = estado.setdefault(chave, {**s, "situacao": "esperando", "tentativas": 0})
        marca = f"retomada-limite {s['sessao'][:8]} {s['volta'][:16]}"
        if reg["situacao"] in ("retomada", "desistiu"):
            continue
        if reg["tentativas"] and entregue(s["historico"], s["parada"], marca):
            reg["situacao"] = "retomada"
            log(f"{chave}: entrega confirmada no histórico")
            continue
        if agora < datetime.fromisoformat(s["volta"]) + MARGEM:
            if not reg.get("avisado"):
                log(f"{chave}: parada às {s['parada'][11:16]}, esperando o limite voltar")
                reg["avisado"] = True
            continue
        vivo = processo_vivo(s["sessao"])
        if not vivo:
            if reg["situacao"] != "sem processo":
                log(f"{chave}: sem processo vivo, retome pelo app")
            reg["situacao"] = "sem processo"
            continue
        if reg["tentativas"] >= TENTATIVAS:
            reg["situacao"] = "desistiu"
            log(f"{chave}: {TENTATIVAS} tentativas sem confirmação, desisti")
            continue
        texto = MENSAGEM.format(
            hora_parada=s["parada"][11:16], hora_volta=s["volta"][11:16],
            mensagem_limite=s["mensagem_limite"], n_subagentes=s["subagentes"],
            n_ativos=s["ativos"], marca=marca,
        )
        reg["tentativas"] += 1
        resposta = enviar(vivo["name"], texto, a.estado.parent)
        reg["resposta"] = resposta
        log(f"{chave}: mensageiro para {vivo['name']} respondeu {resposta}")
        for _ in range(12):
            if entregue(s["historico"], s["parada"], marca):
                reg["situacao"] = "retomada"
                log(f"{chave}: entrega confirmada no histórico")
                break
            time.sleep(5)
        a.estado.write_text(json.dumps(estado, ensure_ascii=False, indent=1))

    a.estado.write_text(json.dumps(estado, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
