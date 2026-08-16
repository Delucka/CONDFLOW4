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
from fastapi import APIRouter, Depends, HTTPException, Request, Header  # type: ignore
from supabase import Client  # type: ignore
from pydantic import BaseModel  # type: ignore

from deps import get_db, get_current_user, carteira_condo_ids
from emails import _enviar_email_smtp

router = APIRouter()

SITE = "https://emissaonline.com"

# A cada 2 dias — pedido da operacao, porque o prazo de emissao e apertado.
INTERVALO_DIAS = 2

ROLES_VEEM_TUDO = ("master", "departamento", "supervisora",
                   "supervisora_contabilidade", "supervisor_gerentes", "integracao")
ROLES_REATIVAM = ("master", "departamento", "integracao")


def require_api_key(request: Request):
    """Auth de maquina para o disparo agendado (mesma chave da integracao)."""
    key = os.getenv("INTEGRACAO_API_KEY")
    if not key or request.headers.get("x-api-key") != key:
        raise HTTPException(401, "API key invalida.")
    return True


def usuario_ou_maquina(request: Request, authorization: Optional[str] = Header(None)) -> dict:
    """Aceita um usuario logado OU a chave de maquina.

    Existe para o agente do WhatsApp (JARVIS, no n8n) consultar e cobrar sem um
    login de pessoa. Ele nao tem sessao — mas tem a mesma `x-api-key` que ja
    protege a integracao.

    A maquina entra com o papel 'integracao', que ve tudo e pode cobrar. O que
    ela NAO pode e suspender: justificativa tem de ser atribuivel a uma pessoa,
    senao "suspenso por JARVIS" vira um beco sem responsavel.
    """
    key = os.getenv("INTEGRACAO_API_KEY")
    if key and request.headers.get("x-api-key") == key:
        return {"id": None, "role": "integracao", "full_name": "JARVIS (n8n)", "maquina": True}
    if not authorization:
        raise HTTPException(401, "Faca login ou envie a x-api-key.")
    return get_current_user(authorization)


def _eh_dia_util(d: datetime.date) -> bool:
    return d.weekday() < 5


# ─────────────────────────── Consulta ───────────────────────────

@router.get("/cobrancas-contas")
def api_listar_cobrancas(status: Optional[str] = None, condominio: Optional[str] = None,
                         user: dict = Depends(usuario_ou_maquina),
                         db: Client = Depends(get_db)):
    """A fila de contas que faltam.

    Gerente e assistente veem a propria carteira; os demais papeis veem tudo.
    O recorte e feito AQUI porque o RLS desta tabela libera a leitura (a policy
    da 0099 e `USING (true)`) — sem este filtro o gerente veria a base inteira.

    `condominio` filtra por nome ou codigo, do jeito que a pessoa fala no
    WhatsApp: "irapuru" ou "436" acham a mesma coisa. E o que o agente usa para
    responder "o que falta do X?" sem precisar da lista inteira.
    """
    try:
        q = db.table("cobrancas_contas").select("*, condominios(name, gerente_id)")
        if status:
            q = q.eq("status", status)

        if condominio:
            termo = condominio.strip()
            alvos = db.table("condominios").select("id").ilike("name", f"%{termo}%").execute().data or []
            if not alvos:
                return {"cobrancas": [], "aviso": f"Nenhum condominio casou com '{termo}'."}
            q = q.in_("condominio_id", [a["id"] for a in alvos])

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


# ─────────────────────────── Abrir a mao ───────────────────────────

class NovaCobrancaBody(BaseModel):
    condominio_id: str
    concessionaria: str
    mes_referencia: int
    ano_referencia: int
    previsto_em: Optional[str] = None


@router.post("/cobrancas-contas")
def api_criar_cobranca(data: NovaCobrancaBody, user: dict = Depends(usuario_ou_maquina),
                       db: Client = Depends(get_db)):
    """Abre uma pendencia sem esperar a proxima leitura aparecer.

    A fila automatica depende da data impressa na fatura anterior, e essa data
    so passou a ser capturada em 16/08/2026 — entao ela nasce quase vazia. Este
    endpoint existe para a operacao poder cobrar HOJE, no que ja sabe estar
    faltando, em vez de esperar um ciclo inteiro.

    Sem `previsto_em` a cobranca ja comeca valendo (data de hoje).
    """
    if user.get("role") not in ROLES_REATIVAM:
        raise HTTPException(403, "Apenas master e emissao abrem cobranca.")

    conc = (data.concessionaria or "").strip().upper()
    if not conc:
        raise HTTPException(400, "Informe a concessionaria.")
    if not (1 <= data.mes_referencia <= 12):
        raise HTTPException(400, "Mes invalido.")

    linha = {
        "condominio_id": data.condominio_id,
        "concessionaria": conc,
        "mes_referencia": data.mes_referencia,
        "ano_referencia": data.ano_referencia,
        "previsto_em": data.previsto_em or datetime.date.today().isoformat(),
    }
    try:
        res = db.table("cobrancas_contas").upsert(
            linha, on_conflict="condominio_id,concessionaria,mes_referencia,ano_referencia"
        ).execute()
    except Exception as e:
        raise HTTPException(400, f"Nao consegui abrir a cobranca: {e}")
    return {"ok": True, "cobranca": (res.data or [None])[0]}


@router.get("/contas-esperadas")
def api_contas_esperadas(condominio_id: str, mes: int, ano: int,
                         user: dict = Depends(usuario_ou_maquina),
                         db: Client = Depends(get_db)):
    """O que o emissor precisa saber ANTES de abrir a emissao de um condominio.

    Para cada concessionaria daquele condominio, responde tres coisas:

      ja_anexada       a fatura do mes ja esta na emissao?
      leitura_prevista o dia em que o medidor e lido para formar essa conta
                       (veio impresso na fatura do mes anterior)
      cobranca         a pendencia, se existe, com status e quantas cobrancas

    A `leitura_prevista` e o que responde "a fatura ainda nem foi emitida" sem
    ninguem precisar ligar para a concessionaria: se o dia ainda nao chegou, nao
    ha o que cobrar; se passou e a conta nao veio, ha.
    """
    concs = []
    try:
        rows = db.table("condominios_concessionarias").select("concessionaria")                  .eq("condominio_id", condominio_id).execute().data or []
        concs = sorted({(r.get("concessionaria") or "").strip().upper() for r in rows if r.get("concessionaria")})
    except Exception as e:
        print(f"[contas-esperadas] concessionarias: {e}")

    # Mes anterior: e la que mora a data da leitura desta conta.
    mes_ant, ano_ant = (12, ano - 1) if mes == 1 else (mes - 1, ano)

    leitura = {}

    def _guarda(conc, data_):
        c = (conc or "").upper()
        if c and data_ and (c not in leitura or data_ > leitura[c]):
            leitura[c] = data_

    ant = db.table("consumos_faturas")         .select("concessionaria, proxima_leitura")         .eq("condominio_id", condominio_id).eq("mes_referencia", mes_ant)         .eq("ano_referencia", ano_ant).execute().data or []
    for r in ant:
        _guarda(r.get("concessionaria"), r.get("proxima_leitura"))

    # Fallback para o proprio anexo da emissao.
    #
    # `consumos_faturas` e alimentada por gatilho, e o gatilho tem condicoes
    # (subtipo, mes, ano e condominio preenchidos). Anexo que nao satisfaz todas
    # nao espelha, e a data fica so em `emissoes_arquivos` — que e de onde a tela
    # de comparativo le. Sem este fallback, a mesma data aparecia num lugar e
    # sumia no outro, o que e pior do que nao ter.
    arq = db.table("emissoes_arquivos")         .select("subtipo, proxima_leitura_fatura")         .eq("condominio_id", condominio_id).eq("mes_referencia", mes_ant)         .eq("ano_referencia", ano_ant).eq("categoria", "concessionaria")         .not_.is_("proxima_leitura_fatura", "null").execute().data or []
    for r in arq:
        _guarda(r.get("subtipo"), r.get("proxima_leitura_fatura"))

    atuais = db.table("consumos_faturas").select("concessionaria")         .eq("condominio_id", condominio_id).eq("mes_referencia", mes)         .eq("ano_referencia", ano).execute().data or []
    anexadas = {(r.get("concessionaria") or "").upper() for r in atuais}

    cobs = db.table("cobrancas_contas")         .select("id, concessionaria, status, cobrancas, ultima_cobranca_em, suspensa_motivo")         .eq("condominio_id", condominio_id).eq("mes_referencia", mes)         .eq("ano_referencia", ano).execute().data or []
    por_conc = {(c.get("concessionaria") or "").upper(): c for c in cobs}

    # Concessionaria que so aparece na fatura (o cadastro de 2025 nao cobre
    # todas) tambem entra: o que importa e o que a operacao ve chegando.
    for c in set(leitura) | anexadas | set(por_conc):
        if c and c not in concs:
            concs.append(c)

    hoje = datetime.date.today().isoformat()
    return {"contas": [{
        "concessionaria": c,
        "ja_anexada": c in anexadas,
        "leitura_prevista": leitura.get(c),
        "leitura_passou": bool(leitura.get(c) and leitura[c] < hoje),
        "cobranca": por_conc.get(c),
    } for c in sorted(concs)]}


@router.get("/contas-esperadas/mes")
def api_contas_esperadas_mes(mes: int, ano: int,
                             user: dict = Depends(usuario_ou_maquina),
                             db: Client = Depends(get_db)):
    """O panorama do mes inteiro: toda conta esperada, de todo condominio.

    E a mesma pergunta de `/contas-esperadas`, feita para a base toda de uma vez
    — para a central de cobranca poder mostrar tudo sem abrir emissao nenhuma.

    Cinco consultas em bloco e o cruzamento na memoria, em vez de quatro
    consultas POR CONDOMINIO. Com 300 condominios a diferenca e entre uma tela
    que abre e uma tela que trava.
    """
    if user.get("role") not in ROLES_VEEM_TUDO:
        raise HTTPException(403, "Sem permissao para ver a cobranca de todos.")

    mes_ant, ano_ant = (12, ano - 1) if mes == 1 else (mes - 1, ano)

    condos = db.table("condominios").select("id, name, tem_consumo").order("name").execute().data or []
    nome = {c["id"]: c["name"] for c in condos}
    com_consumo = {c["id"] for c in condos if c.get("tem_consumo")}

    cadastro = db.table("condominios_concessionarias")         .select("condominio_id, concessionaria").execute().data or []

    def _mapa_leitura(rows, campo_conc, campo_data):
        m = {}
        for r in rows:
            k = (r["condominio_id"], (r.get(campo_conc) or "").upper())
            d = r.get(campo_data)
            if k[1] and d and (k not in m or d > m[k]):
                m[k] = d
        return m

    leitura = _mapa_leitura(
        db.table("consumos_faturas").select("condominio_id, concessionaria, proxima_leitura")
          .eq("mes_referencia", mes_ant).eq("ano_referencia", ano_ant).execute().data or [],
        "concessionaria", "proxima_leitura")
    # Mesmo fallback do endpoint por condominio: o gatilho que espelha em
    # consumos_faturas tem condicoes, e nem todo anexo as satisfaz.
    leitura.update(_mapa_leitura(
        db.table("emissoes_arquivos").select("condominio_id, subtipo, proxima_leitura_fatura")
          .eq("mes_referencia", mes_ant).eq("ano_referencia", ano_ant)
          .eq("categoria", "concessionaria").not_.is_("proxima_leitura_fatura", "null")
          .execute().data or [],
        "subtipo", "proxima_leitura_fatura"))

    anexadas = {(r["condominio_id"], (r.get("concessionaria") or "").upper())
                for r in (db.table("consumos_faturas").select("condominio_id, concessionaria")
                            .eq("mes_referencia", mes).eq("ano_referencia", ano).execute().data or [])}
    anexadas |= {(r["condominio_id"], (r.get("subtipo") or "").upper())
                 for r in (db.table("emissoes_arquivos").select("condominio_id, subtipo")
                             .eq("mes_referencia", mes).eq("ano_referencia", ano)
                             .eq("categoria", "concessionaria").execute().data or [])}

    cobs = {(c["condominio_id"], (c.get("concessionaria") or "").upper()): c
            for c in (db.table("cobrancas_contas")
                        .select("id, condominio_id, concessionaria, status, cobrancas, ultima_cobranca_em, suspensa_motivo, suspensa_por_nome")
                        .eq("mes_referencia", mes).eq("ano_referencia", ano).execute().data or [])}

    # Um condominio entra na lista se tem concessionaria cadastrada, se esta
    # marcado com consumo, ou se ja apareceu em qualquer um dos mapas acima.
    chaves = {(r["condominio_id"], (r.get("concessionaria") or "").upper())
              for r in cadastro if r.get("concessionaria")}
    chaves |= set(leitura) | anexadas | set(cobs)

    hoje = datetime.date.today().isoformat()
    linhas = []
    for (cid, conc) in chaves:
        if cid not in nome:
            continue
        d = leitura.get((cid, conc))
        linhas.append({
            "condominio_id": cid,
            "condominio": nome[cid],
            "concessionaria": conc,
            "ja_anexada": (cid, conc) in anexadas,
            "leitura_prevista": d,
            "leitura_passou": bool(d and d < hoje),
            "tem_consumo": cid in com_consumo,
            "cobranca": cobs.get((cid, conc)),
        })

    # Ordem: o que esta atrasado primeiro, depois por data, depois por nome.
    linhas.sort(key=lambda l: (
        l["ja_anexada"],
        not l["leitura_passou"],
        l["leitura_prevista"] or "9999-99-99",
        l["condominio"],
    ))
    return {"contas": linhas, "mes": mes, "ano": ano}


class CobrarDiretoBody(BaseModel):
    condominio_id: str
    concessionaria: str
    mes_referencia: int
    ano_referencia: int


@router.post("/cobrancas-contas/cobrar-direto")
def api_cobrar_direto(data: CobrarDiretoBody, user: dict = Depends(usuario_ou_maquina),
                      db: Client = Depends(get_db)):
    """Cobra a conta a partir do condominio+mes, criando a pendencia se preciso.

    Existe para o emissor cobrar no exato momento em que descobre que falta —
    ao abrir a emissao — sem ter de ir a outra tela abrir a pendencia primeiro.
    Um clique: abre (ou reaproveita) e manda.
    """
    if user.get("role") not in ROLES_REATIVAM:
        raise HTTPException(403, "Apenas master e emissao cobram.")

    conc = (data.concessionaria or "").strip().upper()
    linha = db.table("cobrancas_contas").select("id, status")         .eq("condominio_id", data.condominio_id).eq("concessionaria", conc)         .eq("mes_referencia", data.mes_referencia).eq("ano_referencia", data.ano_referencia)         .maybe_single().execute().data

    if not linha:
        criada = db.table("cobrancas_contas").insert({
            "condominio_id": data.condominio_id,
            "concessionaria": conc,
            "mes_referencia": data.mes_referencia,
            "ano_referencia": data.ano_referencia,
            "previsto_em": datetime.date.today().isoformat(),
        }).execute()
        linha = (criada.data or [None])[0]
        if not linha:
            raise HTTPException(500, "Nao consegui abrir a cobranca.")

    return api_cobrar_agora(linha["id"], user=user, db=db)


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


@router.post("/cobrancas-contas/{cob_id}/cobrar")
def api_cobrar_agora(cob_id: str, user: dict = Depends(usuario_ou_maquina),
                     db: Client = Depends(get_db)):
    """Manda o e-mail desta conta agora, sem esperar o disparo diario.

    O modo manual e o padrao por enquanto, a pedido da operacao: quem cobra
    escolhe a hora e sabe exatamente o que saiu. O executor agendado continua
    existindo para quando fizer sentido ligar.

    Nao respeita o intervalo de 2 dias nem o fim de semana — quem clicou decidiu
    cobrar agora. Mas conta a cobranca, entao o historico continua honesto.
    """
    if user.get("role") not in ROLES_REATIVAM:
        raise HTTPException(403, "Apenas master e emissao cobram.")

    c = db.table("cobrancas_contas").select("*, condominios(name)").eq("id", cob_id)           .maybe_single().execute().data
    if not c:
        raise HTTPException(404, "Cobranca nao encontrada.")
    if c["status"] == "recebida":
        raise HTTPException(400, "Esta conta ja foi recebida.")
    if c["status"] == "suspensa":
        # Cobrar por cima da suspensao esvaziaria a justificativa: quem escreveu
        # o motivo seria cobrado de novo sem resposta. Para voltar a cobrar,
        # passa pelo /reativar, que exige dizer por que o motivo nao serviu.
        raise HTTPException(400, "Esta cobranca esta suspensa. Use 'Voltar a cobrar' "
                                 "e diga por que a justificativa nao foi aceita.")

    destinos = _destinatarios(db, c["condominio_id"])
    if not destinos:
        raise HTTPException(400, "Este condominio nao tem gerente com e-mail cadastrado.")

    condo_nome = (c.get("condominios") or {}).get("name") or "condominio"
    html = _corpo_email(condo_nome, c["concessionaria"], c["mes_referencia"],
                        c["ano_referencia"], c.get("previsto_em"),
                        c.get("cobrancas") or 0, c.get("reativada_motivo"))
    assunto = (f"Falta a conta {c['concessionaria']} — {condo_nome} "
               f"({str(c['mes_referencia']).zfill(2)}/{c['ano_referencia']})")

    enviados = [e for e, _n in destinos if _enviar_email_smtp(e, assunto, html)]
    if not enviados:
        raise HTTPException(502, "Nenhum e-mail saiu. Confira as credenciais de envio.")

    db.table("cobrancas_contas").update({
        "cobrancas": (c.get("cobrancas") or 0) + 1,
        "ultima_cobranca_em": datetime.datetime.utcnow().isoformat(),
    }).eq("id", cob_id).execute()

    return {"ok": True, "enviados_para": enviados}


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
