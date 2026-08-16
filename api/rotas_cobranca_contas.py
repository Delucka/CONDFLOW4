"""Cobranca das contas de concessionaria.

A emissao trava esperando a conta de agua, gas ou energia chegar, e a cobranca
era alguem lembrar de perguntar. Aqui ela vira fila com estado.

O que dispara: a PROXIMA LEITURA que vem impressa na fatura do mes anterior.
Ela diz quando a concessionaria le o medidor de novo, ou seja, quando a conta do
mes seguinte se forma. Com isso da para agendar a cobranca com um mes de
antecedencia, em vez de descobrir o atraso na hora de emitir.

Quem e cobrado: o gerente da carteira e o assistente vinculado a ele (0057).

Tres estados, e a regra de cada um:
  aguardando  cobra por e-mail a cada 2 dias uteis a partir da data da leitura
  recebida    fecha SOZINHA quando a fatura e anexada (gatilho da 0099)
  suspensa    justificada por quem esta sendo cobrado; o e-mail para

Master e emissao podem julgar a justificativa ruim e mandar VOLTAR A COBRAR.
Isso e um estado proprio, com motivo e autor registrados — nao um desfazer que
apaga o que houve.
"""

import os
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request  # type: ignore
from supabase import Client  # type: ignore
from pydantic import BaseModel  # type: ignore

from deps import get_db, get_current_user, carteira_condo_ids
from emails import _enviar_email_smtp

router = APIRouter()

SITE = "https://emissaonline.com"

# A cada 2 dias — pedido da operacao, porque o prazo de emissao e apertado.
INTERVALO_DIAS = 2

ROLES_VEEM_TUDO = ("master", "departamento", "supervisora",
                   "supervisora_contabilidade", "supervisor_gerentes")
ROLES_REATIVAM = ("master", "departamento")


def require_api_key(request: Request):
    """Auth de maquina para o disparo agendado (mesma chave da integracao)."""
    key = os.getenv("INTEGRACAO_API_KEY")
    if not key or request.headers.get("x-api-key") != key:
        raise HTTPException(401, "API key invalida.")
    return True


def _eh_dia_util(d: datetime.date) -> bool:
    return d.weekday() < 5


# ─────────────────────────── Consulta ───────────────────────────

@router.get("/cobrancas-contas")
def api_listar_cobrancas(status: Optional[str] = None, user: dict = Depends(get_current_user),
                         db: Client = Depends(get_db)):
    """A fila de contas que faltam.

    Gerente e assistente veem a propria carteira; os demais papeis veem tudo.
    O recorte e feito AQUI porque o RLS desta tabela libera a leitura (a policy
    da 0099 e `USING (true)`) — sem este filtro o gerente veria a base inteira.
    """
    try:
        q = db.table("cobrancas_contas").select("*, condominios(name, gerente_id)")
        if status:
            q = q.eq("status", status)

        if user.get("role") not in ROLES_VEEM_TUDO:
            meus = carteira_condo_ids(db, user)
            if not meus:
                return {"cobrancas": []}
            q = q.in_("condominio_id", meus)

        linhas = q.order("previsto_em").execute().data or []
        hoje = datetime.date.today()
        for c in linhas:
            prev = c.get("previsto_em")
            c["atrasada"] = bool(prev and c.get("status") == "aguardando" and prev < hoje.isoformat())
        return {"cobrancas": linhas}
    except Exception as e:
        raise HTTPException(500, f"Nao consegui ler a fila de cobrancas: {e}")


# ─────────────────────────── Suspender / reativar ───────────────────────────

class SuspenderBody(BaseModel):
    motivo: str


@router.post("/cobrancas-contas/{cob_id}/suspender")
def api_suspender_cobranca(cob_id: str, data: SuspenderBody,
                           user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Quem esta sendo cobrado explica e o e-mail para.

    Sem aprovacao previa de propósito: travar a suspensao criaria fila para quem
    ja esta cheio. O controle e por transparencia — a justificativa fica visivel,
    com nome e data, e master/emissao podem mandar voltar a cobrar.
    """
    motivo = (data.motivo or "").strip()
    if len(motivo) < 10:
        raise HTTPException(400, "Escreva o motivo (pelo menos uma frase). Ele fica visivel para a emissao.")

    cob = db.table("cobrancas_contas").select("*").eq("id", cob_id).maybe_single().execute().data
    if not cob:
        raise HTTPException(404, "Cobranca nao encontrada.")
    if cob["status"] == "recebida":
        raise HTTPException(400, "Esta conta ja foi recebida — nao ha o que suspender.")

    # Gerente e assistente so mexem na propria carteira.
    if user.get("role") not in ROLES_VEEM_TUDO:
        if cob["condominio_id"] not in carteira_condo_ids(db, user):
            raise HTTPException(403, "Este condominio nao e da sua carteira.")

    res = db.table("cobrancas_contas").update({
        "status": "suspensa",
        "suspensa_motivo": motivo,
        "suspensa_por": user["id"],
        "suspensa_por_nome": user.get("full_name") or user.get("email"),
        "suspensa_em": datetime.datetime.utcnow().isoformat(),
        # Zera a reativacao anterior: o que vale e a ultima decisao.
        "reativada_motivo": None, "reativada_por": None,
        "reativada_por_nome": None, "reativada_em": None,
    }).eq("id", cob_id).execute()
    if not res.data:
        raise HTTPException(500, "Nao consegui suspender.")
    return {"ok": True}


@router.post("/cobrancas-contas/{cob_id}/reativar")
def api_reativar_cobranca(cob_id: str, data: SuspenderBody,
                          user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Master ou emissao nao aceitou a justificativa: a cobranca volta.

    O motivo da recusa e obrigatorio e vai no e-mail seguinte. Cobranca que volta
    sem explicacao vira briga; com explicacao, vira combinado.
    """
    if user.get("role") not in ROLES_REATIVAM:
        raise HTTPException(403, "Apenas master e emissao podem mandar voltar a cobrar.")

    motivo = (data.motivo or "").strip()
    if len(motivo) < 10:
        raise HTTPException(400, "Escreva por que a justificativa nao foi aceita.")

    cob = db.table("cobrancas_contas").select("status").eq("id", cob_id).maybe_single().execute().data
    if not cob:
        raise HTTPException(404, "Cobranca nao encontrada.")
    if cob["status"] == "recebida":
        raise HTTPException(400, "Esta conta ja foi recebida.")

    res = db.table("cobrancas_contas").update({
        "status": "aguardando",
        "reativada_motivo": motivo,
        "reativada_por": user["id"],
        "reativada_por_nome": user.get("full_name") or user.get("email"),
        "reativada_em": datetime.datetime.utcnow().isoformat(),
        # Cobra de novo no proximo disparo, sem esperar o intervalo.
        "ultima_cobranca_em": None,
    }).eq("id", cob_id).execute()
    if not res.data:
        raise HTTPException(500, "Nao consegui reativar.")
    return {"ok": True}


# ─────────────────────────── O disparo ───────────────────────────

def _destinatarios(db: Client, condominio_id: str):
    """E-mails do gerente da carteira e do assistente vinculado a ele.

    O vinculo do assistente e `profiles.gerente_id`, que guarda o PROFILE do
    gerente e nao o `gerentes.id` — a Armadilha 2 do docs/ESQUEMA-BANCO.md.
    """
    condo = db.table("condominios").select("gerente_id").eq("id", condominio_id) \
              .maybe_single().execute().data
    if not condo or not condo.get("gerente_id"):
        return []

    ger = db.table("gerentes").select("profile_id").eq("id", condo["gerente_id"]) \
            .maybe_single().execute().data
    if not ger or not ger.get("profile_id"):
        return []

    pids = [ger["profile_id"]]
    assist = db.table("profiles").select("id").eq("gerente_id", ger["profile_id"]) \
               .eq("role", "assistente").execute().data or []
    pids += [a["id"] for a in assist]

    perfis = db.table("profiles").select("email, full_name").in_("id", pids).execute().data or []
    return [(p["email"], p.get("full_name")) for p in perfis if p.get("email")]


def _corpo_email(condo_nome, concessionaria, mes, ano, previsto_em, cobrancas, reativada_motivo):
    atraso = ""
    if previsto_em:
        try:
            dias = (datetime.date.today() - datetime.date.fromisoformat(previsto_em)).days
            if dias > 0:
                atraso = f"<p>A leitura foi em <b>{'/'.join(reversed(previsto_em.split('-')))}</b> — {dias} dia(s) atras.</p>"
        except Exception:
            pass

    recusa = ""
    if reativada_motivo:
        recusa = ("<p style='background:#fdf2e3;border-left:3px solid #96530a;padding:10px 12px'>"
                  f"<b>A justificativa anterior nao foi aceita:</b><br>{reativada_motivo}</p>")

    insistencia = "" if cobrancas < 1 else f"<p style='color:#96530a'><b>{cobrancas + 1}ª cobranca desta conta.</b></p>"

    return (
        f"<p>Falta a conta da <b>{concessionaria}</b> de <b>{condo_nome}</b>, "
        f"referencia <b>{str(mes).zfill(2)}/{ano}</b>.</p>"
        f"{atraso}{recusa}{insistencia}"
        "<p>Sem ela a emissao do mes fica parada.</p>"
        f"<p>Se ja enviou, basta anexar em <a href='{SITE}/central-emissoes'>Central de Emissoes</a> "
        "que esta cobranca para sozinha.</p>"
        f"<p>Se houver motivo para atrasar, registre em <a href='{SITE}/consumos'>Consumos</a> "
        "— com a justificativa escrita, a cobranca suspende.</p>"
    )


@router.post("/cobrancas-contas/executar")
def api_executar_cobrancas(request: Request, simular: bool = False,
                           _: bool = Depends(require_api_key),
                           db: Client = Depends(get_db)):
    """Dispara os e-mails do dia. Chamado pelo n8n, uma vez por dia.

    Idempotente por construcao: cobra so quem esta 'aguardando', ja passou da
    data da leitura e nao foi cobrado nos ultimos 2 dias. Rodar duas vezes no
    mesmo dia nao manda dois e-mails.

    Fim de semana nao dispara. E-mail de cobranca no sabado nao e pressao, e
    ruido — e faz a pessoa parar de ler os da semana.

    `?simular=true` roda a selecao inteira e devolve o que SERIA enviado, para
    quem, sem mandar nada e sem gravar. Serve para conferir a fila antes de
    agendar — inclusive no fim de semana, quando o disparo real nao roda.
    """
    hoje = datetime.date.today()
    if not _eh_dia_util(hoje) and not simular:
        return {"ok": True, "pulado": "fim de semana", "enviados": 0}

    corte = (datetime.datetime.utcnow() - datetime.timedelta(days=INTERVALO_DIAS)).isoformat()

    linhas = db.table("cobrancas_contas") \
        .select("*, condominios(name)") \
        .eq("status", "aguardando") \
        .lte("previsto_em", hoje.isoformat()) \
        .execute().data or []

    enviados, sem_destino, falhas = 0, 0, 0
    previa = []
    for c in linhas:
        ultima = c.get("ultima_cobranca_em")
        if ultima and ultima > corte:
            continue   # cobrado ha menos de 2 dias

        destinos = _destinatarios(db, c["condominio_id"])
        if not destinos:
            sem_destino += 1
            if simular:
                previa.append({"condominio": (c.get("condominios") or {}).get("name"),
                               "concessionaria": c["concessionaria"],
                               "para": [], "problema": "condominio sem gerente com e-mail"})
            continue

        condo_nome = (c.get("condominios") or {}).get("name") or "condominio"

        if simular:
            previa.append({
                "condominio": condo_nome,
                "concessionaria": c["concessionaria"],
                "referencia": f"{str(c['mes_referencia']).zfill(2)}/{c['ano_referencia']}",
                "leitura_em": c.get("previsto_em"),
                "cobranca_numero": (c.get("cobrancas") or 0) + 1,
                "para": [e for e, _n in destinos],
            })
            enviados += 1
            continue
        html = _corpo_email(condo_nome, c["concessionaria"], c["mes_referencia"],
                            c["ano_referencia"], c.get("previsto_em"),
                            c.get("cobrancas") or 0, c.get("reativada_motivo"))
        assunto = f"Falta a conta {c['concessionaria']} — {condo_nome} ({str(c['mes_referencia']).zfill(2)}/{c['ano_referencia']})"

        ok_algum = False
        for email, _nome in destinos:
            if _enviar_email_smtp(email, assunto, html):
                ok_algum = True

        if not ok_algum:
            falhas += 1
            continue

        db.table("cobrancas_contas").update({
            "cobrancas": (c.get("cobrancas") or 0) + 1,
            "ultima_cobranca_em": datetime.datetime.utcnow().isoformat(),
        }).eq("id", c["id"]).execute()
        enviados += 1

    if simular:
        return {"ok": True, "simulacao": True, "seriam_enviados": enviados,
                "sem_destinatario": sem_destino, "candidatas": len(linhas),
                "previa": previa}

    return {"ok": True, "enviados": enviados, "sem_destinatario": sem_destino,
            "falhas_envio": falhas, "candidatas": len(linhas)}
