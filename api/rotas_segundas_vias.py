"""Segundas vias de boleto: a fila do site e o atendimento pelo WhatsApp.

Saiu do `api_routes.py` inteiro, com os seus ajudantes — o arquivo estava com
5.137 linhas, e este dominio nao compartilha nada com o resto alem da conexao e
do login, que agora moram em `deps.py`.

Inclui tres portas para o mesmo pedido:
  * o site (fila em /carteiras/segundas-vias)
  * a integracao por API-key (n8n / Ahreas)
  * o passo a passo do WhatsApp (`_wa_step`), com um simulador autenticado para
    testar o fluxo sem depender do n8n nem da Meta.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request  # type: ignore
from supabase import Client  # type: ignore
from pydantic import BaseModel  # type: ignore

from deps import get_db, get_current_user, carteira_condo_ids
from emails import _enviar_email_smtp

router = APIRouter()

# ═══ Segundas Vias (fila de pedidos de boleto 2ª via) ════════════════
_MODALIDADE_LABEL = {"com_multa": "Com multa", "sem_multa": "Sem multa", "quinto_andar": "Quinto Andar (venc. +5 dias)"}
ROLES_SEGVIA_ATENDE = ("master", "departamento")
ROLES_SEGVIA_ABRE = ("master", "departamento", "gerente", "assistente")

class SegundaViaCreate(BaseModel):
    condominio_id: str
    unidade: str
    bloco: Optional[str] = None
    ref_mes: Optional[int] = None
    ref_ano: Optional[int] = None
    vencimento: Optional[str] = None        # ISO date
    modalidade: str = "com_multa"
    email_destinatario: Optional[str] = None
    observacoes: Optional[str] = None
    anexo_url: Optional[str] = None
    anexo_nome: Optional[str] = None

@router.post("/segundas-vias")
def api_criar_segunda_via(data: SegundaViaCreate, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] not in ROLES_SEGVIA_ABRE:
        raise HTTPException(403, "Sem permissão para abrir solicitação.")
    if user["role"] in ("gerente", "assistente") and data.condominio_id not in carteira_condo_ids(db, user):
        raise HTTPException(403, "Este condomínio não está na sua carteira.")
    if data.modalidade not in ("com_multa", "sem_multa", "quinto_andar"):
        raise HTTPException(400, "Modalidade inválida.")
    if not (data.unidade and data.unidade.strip()):
        raise HTTPException(400, "Informe a unidade.")
    if not (data.observacoes and data.observacoes.strip()):
        raise HTTPException(400, "Descreva a solicitação nas observações.")
    if not (data.email_destinatario and data.email_destinatario.strip()):
        raise HTTPException(400, "Informe o e-mail do destinatário (obrigatório).")
    if data.modalidade == "sem_multa" and not (data.anexo_url and data.anexo_url.strip()):
        raise HTTPException(400, "Sem multa exige anexar a autorização do síndico/gerente.")

    venc = data.vencimento
    if data.modalidade == "quinto_andar":
        import datetime
        minv = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
        if not venc or venc < minv:
            venc = minv

    ins = db.table("segundas_vias").insert({
        "condominio_id": data.condominio_id, "unidade": data.unidade.strip(),
        "bloco": (data.bloco or "").strip() or None,
        "ref_mes": data.ref_mes, "ref_ano": data.ref_ano, "vencimento": venc,
        "modalidade": data.modalidade,
        "email_destinatario": (data.email_destinatario or "").strip() or None,
        "observacoes": data.observacoes, "anexo_url": data.anexo_url, "anexo_nome": data.anexo_nome,
        "origem": "site",
        "criado_por": user["id"], "criado_por_nome": user.get("full_name"), "criado_por_email": user.get("email"),
    }).execute().data
    sv = ins[0] if ins else {}

    _log_sv_hist(db, sv.get("id"), "criacao",
                 autor_id=user["id"], autor_nome=user.get("full_name") or user.get("email"),
                 vencimento=venc, ref_mes=data.ref_mes, ref_ano=data.ref_ano,
                 modalidade=data.modalidade, email_destinatario=(data.email_destinatario or "").strip() or None,
                 motivo=(data.observacoes or "").strip() or None)

    # Notifica o time (departamento + master) — sino + e-mail
    try:
        condo = db.table("condominios").select("name").eq("id", data.condominio_id).maybe_single().execute().data or {}
        cnome = condo.get("name") or "Condomínio"
        for p in (db.table("profiles").select("id").in_("role", list(ROLES_SEGVIA_ATENDE)).execute().data or []):
            db.table("notificacoes").insert({
                "user_id": p["id"], "tipo": "segunda_via",
                "titulo": "Nova solicitação de 2ª via",
                "mensagem": f"{cnome} · unidade {data.unidade} · {_MODALIDADE_LABEL.get(data.modalidade, data.modalidade)}.",
                "link": "/carteiras/segundas-vias",
            }).execute()
    except Exception as e:
        print(f"[segunda_via] notif: {e}")

    return {"ok": True, "id": sv.get("id"), "vencimento": venc}


@router.get("/segundas-vias")
def api_listar_segundas_vias(status: str = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] not in ROLES_SEGVIA_ABRE:
        raise HTTPException(403, "Sem permissão.")
    q = db.table("segundas_vias").select("*, condominios(name)").order("criado_em", desc=True)
    if status:
        q = q.eq("status", status)
    # Gerente/assistente: escopa pela carteira NA QUERY (antes do limite). Antes o
    # filtro era em Python DEPOIS de pegar as 300 globais mais recentes — com a fila
    # crescendo, os itens do gerente podiam ficar de fora das 300. Agora o limite é
    # aplicado já dentro da carteira dele.
    if user["role"] in ("gerente", "assistente"):
        ids = carteira_condo_ids(db, user)
        if not ids:
            return {"solicitacoes": []}
        q = q.in_("condominio_id", ids)
    rows = q.limit(300).execute().data or []
    return {"solicitacoes": rows}


def _emails_assistentes_condo(db, condominio_id):
    """E-mails dos assistentes ligados ao gerente do condomínio — pra CC na 2ª via.
    condominios.gerente_id -> gerentes.profile_id (profile do gerente) -> profiles
    (role='assistente', gerente_id = profile do gerente, migration 0057)."""
    try:
        if not condominio_id:
            return []
        condo = db.table("condominios").select("gerente_id").eq("id", condominio_id).maybe_single().execute().data
        if not condo or not condo.get("gerente_id"):
            return []
        ger = db.table("gerentes").select("profile_id").eq("id", condo["gerente_id"]).maybe_single().execute().data
        gp = (ger or {}).get("profile_id")
        if not gp:
            return []
        assist = db.table("profiles").select("email, notificacao_email").eq("role", "assistente").eq("gerente_id", gp).execute().data or []
        out = []
        for a in assist:
            e = (a.get("notificacao_email") or a.get("email") or "").strip()
            if e:
                out.append(e)
        return out
    except Exception as _e:
        print(f"[segunda_via] assistentes p/ CC: {_e}")
        return []


def _log_sv_hist(db, sv_id, tipo, autor_id=None, autor_nome=None, **campos):
    """Grava um evento na linha do tempo (auditoria) de uma 2ª via: quem/quando +
    snapshot dos dados e, nas emissões, o boleto daquele momento (preservado, não
    sobrescrito). tipo: criacao | solicitacao_alteracao | emissao | cancelamento."""
    try:
        if not sv_id:
            return
        row = {"segunda_via_id": sv_id, "tipo": tipo, "autor_id": autor_id, "autor_nome": autor_nome}
        for k, v in campos.items():
            if v is not None:
                row[k] = v
        db.table("segundas_vias_historico").insert(row).execute()
    except Exception as e:
        print(f"[segunda_via] hist {tipo}: {e}")


def _fmt_data_br(d):
    """ISO 'YYYY-MM-DD' -> 'DD/MM/YYYY' (pra descrever alterações no histórico)."""
    try:
        y, m, dd = str(d).split("-")[:3]
        return f"{dd[:2]}/{m}/{y}"
    except Exception:
        return str(d or "")


def _emitir_segunda_via(db, sv, boleto_url=None, boleto_nome=None, enviar_email=True, atendido_por=None, atendido_nome=None):
    """Marca a 2ª via como emitida, anexa o boleto e (se enviar_email) dispara o e-mail
    padrão do boleto + CC do solicitante e dos assistentes da carteira. Retorna
    email_enviado. Reutilizado pelo endpoint manual e pela integração (n8n/Ahreas)."""
    import datetime
    sv_id = sv["id"]
    boleto_url = boleto_url or sv.get("boleto_url")
    boleto_nome = boleto_nome or sv.get("boleto_nome")
    upd = {
        "status": "emitido", "boleto_url": boleto_url, "boleto_nome": boleto_nome,
        "atendido_em": datetime.datetime.utcnow().isoformat(),
    }
    if atendido_por:
        upd["atendido_por"] = atendido_por
    db.table("segundas_vias").update(upd).eq("id", sv_id).execute()

    email_enviado = False
    dest = (sv.get("email_destinatario") or "").strip()
    if enviar_email and dest:
        try:
            cnome = (sv.get("condominios") or {}).get("name") or "seu condomínio"
            ref = f"{int(sv['ref_mes']):02d}/{sv['ref_ano']}" if (sv.get("ref_mes") and sv.get("ref_ano")) else ""
            h = (datetime.datetime.utcnow().hour - 3) % 24      # saudação por horário (BRT)
            saud = "bom dia" if 5 <= h < 12 else ("boa tarde" if 12 <= h < 18 else "boa noite")
            pp = "https://www.propstarter.com.br"
            url_and = "https://play.google.com/store/apps/details?id=br.com.winker"
            url_ios = "https://apps.apple.com/br/app/winker/id1121080703"
            corpo = (
                f"Prezado(a), {saud}!<br><br>"
                "Conforme solicitação, segue em anexo o boleto referente ao seu condomínio.<br><br>"
                "Se o boleto vencer e estiver dentro do prazo de 30 dias, você pode atualizá-lo de duas formas:<br><br>"
                f"&bull; <strong>Pelo site:</strong> Acesse <a href=\"{pp}\" style=\"color:#1e3a8a;\">www.propstarter.com.br</a>, "
                "faça login e clique no menu &quot;Acesso Rápido&quot; / &quot;2ª Via de Pagamento&quot;.<br><br>"
                f"&bull; <strong>Pelo aplicativo:</strong> Baixe o app <strong>Prop Starter</strong> "
                f"(<a href=\"{url_and}\" style=\"color:#1e3a8a;\">PROPSTARTER Android</a> ou <a href=\"{url_ios}\" style=\"color:#1e3a8a;\">PROPSTARTER iOS</a>) "
                "no seu celular ou tablet para acessar a segunda via e conferir documentos como balancetes, convenção e especificações do condomínio.<br><br>"
                "<strong style=\"color:#c0392b;\">IMPORTANTE</strong><br><br>"
                "O boleto original pode ser pago em até 30 (trinta) dias após o vencimento. O Banco Itaú, em atendimento à "
                "Normativa nº 2.119 da Receita Federal e à Circular nº 3.978 do Banco Central, não acatará o registro de boletos "
                "bancários cujo CPF/CNPJ do pagador esteja em situação diferente de ATIVO/REGULAR. "
                "<strong>Nossos boletos são emitidos exclusivamente pelo Banco Itaú S.A. ou pelo Banco Bradesco S.A. "
                "Confira sempre o local de pagamento e verifique se o beneficiário consta como o próprio Condomínio ou a Prop Starter "
                "no momento do pagamento.</strong><br><br>"
                "Atenciosamente,"
            )
            titulo = f"Boleto atualizado · {ref}" if ref else "Boleto atualizado"
            html = db.rpc("email_template", {"p_titulo": titulo, "p_mensagem": corpo, "p_link": ""}).execute().data
            anexos = []
            if boleto_url:
                try:
                    pdf = db.storage.from_("emissoes").download(boleto_url)
                    anexos.append((boleto_nome or "boleto.pdf", pdf, "application/pdf"))
                except Exception as e:
                    print(f"[segunda_via] download boleto: {e}")
            # CC: quem abriu o chamado + os assistentes da carteira do condomínio (dedup, sem o destinatário)
            cc = []
            if sv.get("criado_por_email"):
                cc.append(sv["criado_por_email"])
            cc.extend(_emails_assistentes_condo(db, sv.get("condominio_id")))
            cc = list(dict.fromkeys([c for c in cc if c and c.strip().lower() != dest.strip().lower()]))
            bloco_txt = (sv.get("bloco") or "").strip()
            assunto = (
                f"{cnome} - Unid. {sv.get('unidade') or ''}"
                + (f" Bl. {bloco_txt}" if bloco_txt else "")
                + (f" - Boleto {ref}" if ref else " - Boleto")
            )
            if isinstance(html, str) and html:
                email_enviado = _enviar_email_smtp(dest, assunto, html, cc=cc, anexos=anexos)
            db.table("segundas_vias").update({"email_enviado": email_enviado}).eq("id", sv_id).execute()
        except Exception as e:
            print(f"[segunda_via] emitir/email: {e}")

    # Linha do tempo: guarda ESTE boleto (arquivo preservado no bucket) + snapshot
    _log_sv_hist(
        db, sv_id, "emissao",
        autor_id=atendido_por,
        autor_nome=(atendido_nome or (None if atendido_por else "Integração")),
        vencimento=sv.get("vencimento"), ref_mes=sv.get("ref_mes"), ref_ano=sv.get("ref_ano"),
        modalidade=sv.get("modalidade"), email_destinatario=(dest or sv.get("email_destinatario")),
        boleto_url=boleto_url, boleto_nome=boleto_nome, email_enviado=email_enviado,
    )
    return email_enviado


class SegundaViaEmitir(BaseModel):
    boleto_url: Optional[str] = None
    boleto_nome: Optional[str] = None
    enviar_email: bool = True

@router.post("/segundas-vias/{sv_id}/emitir")
def api_emitir_segunda_via(sv_id: str, data: SegundaViaEmitir, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] not in ROLES_SEGVIA_ATENDE:
        raise HTTPException(403, "Apenas o time de 2ª via pode emitir.")
    sv = db.table("segundas_vias").select("*, condominios(name)").eq("id", sv_id).maybe_single().execute().data
    if not sv:
        raise HTTPException(404, "Solicitação não encontrada.")
    email_enviado = _emitir_segunda_via(db, sv, data.boleto_url, data.boleto_nome, data.enviar_email,
                                        atendido_por=user["id"], atendido_nome=user.get("full_name"))
    return {"ok": True, "email_enviado": email_enviado}


@router.post("/segundas-vias/{sv_id}/cancelar")
def api_cancelar_segunda_via(sv_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    sv = db.table("segundas_vias").select("criado_por").eq("id", sv_id).maybe_single().execute().data
    if not sv:
        raise HTTPException(404, "Não encontrada.")
    if user["role"] not in ROLES_SEGVIA_ATENDE and sv.get("criado_por") != user["id"]:
        raise HTTPException(403, "Sem permissão.")
    db.table("segundas_vias").update({"status": "cancelado"}).eq("id", sv_id).execute()
    _log_sv_hist(db, sv_id, "cancelamento",
                 autor_id=user["id"], autor_nome=user.get("full_name") or user.get("email"))
    return {"ok": True}


class SegundaViaAlterar(BaseModel):
    motivo: str
    vencimento: Optional[str] = None
    ref_mes: Optional[int] = None
    ref_ano: Optional[int] = None
    modalidade: Optional[str] = None
    email_destinatario: Optional[str] = None


@router.post("/segundas-vias/{sv_id}/solicitar-alteracao")
def api_solicitar_alteracao_sv(sv_id: str, data: SegundaViaAlterar, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Pede alteração (ex.: nova data) numa 2ª via existente, SEM abrir outro chamado:
    atualiza os campos, reabre pra a fila (status=pendente) e avisa o time de 2ª via."""
    if user["role"] not in ROLES_SEGVIA_ABRE:
        raise HTTPException(403, "Sem permissão.")
    if not (data.motivo and data.motivo.strip()):
        raise HTTPException(400, "Descreva o motivo da alteração.")
    sv = db.table("segundas_vias").select("*, condominios(name)").eq("id", sv_id).maybe_single().execute().data
    if not sv:
        raise HTTPException(404, "Solicitação não encontrada.")
    if user["role"] in ("gerente", "assistente") and sv.get("condominio_id") not in carteira_condo_ids(db, user):
        raise HTTPException(403, "Este condomínio não está na sua carteira.")
    if sv.get("status") == "cancelado":
        raise HTTPException(400, "Solicitação cancelada não pode ser alterada.")

    import datetime
    upd = {"status": "pendente", "email_enviado": False}
    mudancas = []   # de->para legível pro histórico
    if data.vencimento and data.vencimento != sv.get("vencimento"):
        upd["vencimento"] = data.vencimento
        mudancas.append(f"venc. {_fmt_data_br(sv.get('vencimento')) or '—'} → {_fmt_data_br(data.vencimento)}")
    if data.ref_mes and data.ref_mes != sv.get("ref_mes"):
        upd["ref_mes"] = data.ref_mes
        mudancas.append(f"mês ref. {sv.get('ref_mes') or '—'} → {data.ref_mes}")
    if data.ref_ano and data.ref_ano != sv.get("ref_ano"):
        upd["ref_ano"] = data.ref_ano
        mudancas.append(f"ano ref. {sv.get('ref_ano') or '—'} → {data.ref_ano}")
    if data.modalidade in ("com_multa", "sem_multa", "quinto_andar") and data.modalidade != sv.get("modalidade"):
        upd["modalidade"] = data.modalidade
        mudancas.append(f"modalidade {sv.get('modalidade') or '—'} → {data.modalidade}")
    novo_email = (data.email_destinatario or "").strip()
    if novo_email and novo_email.lower() != (sv.get("email_destinatario") or "").strip().lower():
        upd["email_destinatario"] = novo_email
        mudancas.append(f"e-mail {sv.get('email_destinatario') or '—'} → {novo_email}")
    quando = (datetime.datetime.utcnow() - datetime.timedelta(hours=3)).strftime("%d/%m/%Y %H:%M")
    nota = f"[Alteração solicitada por {user.get('full_name') or 'usuário'} em {quando}]: {data.motivo.strip()}"
    upd["observacoes"] = ((sv.get("observacoes") or "").strip() + "\n\n" + nota).strip()
    db.table("segundas_vias").update(upd).eq("id", sv_id).execute()

    # Linha do tempo: quem pediu, quando, motivo e o de->para
    _log_sv_hist(db, sv_id, "solicitacao_alteracao",
                 autor_id=user["id"], autor_nome=user.get("full_name") or user.get("email"),
                 motivo=data.motivo.strip(), detalhes=("; ".join(mudancas) or None),
                 vencimento=upd.get("vencimento") or sv.get("vencimento"),
                 ref_mes=upd.get("ref_mes") or sv.get("ref_mes"),
                 ref_ano=upd.get("ref_ano") or sv.get("ref_ano"),
                 modalidade=upd.get("modalidade") or sv.get("modalidade"),
                 email_destinatario=upd.get("email_destinatario") or sv.get("email_destinatario"))

    # Avisa o time (departamento + master) — sino
    try:
        cnome = (sv.get("condominios") or {}).get("name") or "Condomínio"
        for p in (db.table("profiles").select("id").in_("role", list(ROLES_SEGVIA_ATENDE)).execute().data or []):
            db.table("notificacoes").insert({
                "user_id": p["id"], "tipo": "segunda_via",
                "titulo": "Alteração pedida em 2ª via",
                "mensagem": f"{cnome} · unidade {sv.get('unidade') or ''}: {data.motivo.strip()[:80]}",
                "link": "/carteiras/segundas-vias",
            }).execute()
    except Exception as e:
        print(f"[segunda_via] alteracao notif: {e}")

    return {"ok": True}


@router.get("/segundas-vias/{sv_id}/historico")
def api_historico_segunda_via(sv_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Linha do tempo da 2ª via: criação, pedidos de alteração e cada emissão de
    boleto (com o arquivo daquele momento preservado) — pra comparação/comprovação."""
    if user["role"] not in ROLES_SEGVIA_ABRE:
        raise HTTPException(403, "Sem permissão.")
    sv = db.table("segundas_vias").select("id, condominio_id, unidade, bloco, condominios(name)").eq("id", sv_id).maybe_single().execute().data
    if not sv:
        raise HTTPException(404, "Solicitação não encontrada.")
    if user["role"] in ("gerente", "assistente") and sv.get("condominio_id") not in carteira_condo_ids(db, user):
        raise HTTPException(403, "Este condomínio não está na sua carteira.")
    eventos = db.table("segundas_vias_historico").select("*").eq("segunda_via_id", sv_id).order("criado_em").execute().data or []
    return {"segunda_via": sv, "eventos": eventos}


# ═══ Integração externa (n8n / WhatsApp / Ahreas) — protegida por API-key ═══════════
def require_api_key(request: Request):
    """Auth de máquina: header x-api-key == env INTEGRACAO_API_KEY. (espelha o email-hook)"""
    import os
    key = os.getenv("INTEGRACAO_API_KEY")
    if not key or request.headers.get("x-api-key") != key:
        raise HTTPException(401, "API key inválida.")
    return True

def _resolve_condominio(db, termo):
    """Acha o condomínio por código (prefixo do name, ex '403') ou por nome (ilike)."""
    t = (termo or "").strip()
    if not t:
        return None
    digs = "".join(ch for ch in t if ch.isdigit())
    if digs:
        for cand in {digs, digs.lstrip("0"), digs.zfill(3), digs.zfill(4)}:
            for padrao in (f"{cand} -%", f"{cand} %", f"{cand}-%"):
                r = db.table("condominios").select("id, name").ilike("name", padrao).limit(1).execute().data
                if r:
                    return r[0]
    r = db.table("condominios").select("id, name").ilike("name", f"%{t}%").limit(1).execute().data
    return r[0] if r else None

def _criar_sv_integracao(db, condo, unidade, bloco, ref_mes, ref_ano, modalidade, venc, email, obs, solicitante, ahreas_ref=None):
    """Insere o pedido de 2ª via (origem externa) + notifica o time. Retorna a linha."""
    cc_email = None
    try:
        gid = (db.table("condominios").select("gerente_id").eq("id", condo["id"]).maybe_single().execute().data or {}).get("gerente_id")
        if gid:
            g = db.table("gerentes").select("profile_id").eq("id", gid).maybe_single().execute().data
            if g and g.get("profile_id"):
                p = db.table("profiles").select("email").eq("id", g["profile_id"]).maybe_single().execute().data
                cc_email = (p or {}).get("email")
    except Exception:
        pass
    ins = db.table("segundas_vias").insert({
        "condominio_id": condo["id"], "unidade": (unidade or "").strip(),
        "bloco": (bloco or "").strip() or None,
        "ref_mes": ref_mes, "ref_ano": ref_ano, "vencimento": venc,
        "modalidade": modalidade,
        "email_destinatario": (email or "").strip() or None,
        "observacoes": obs, "origem": "whatsapp",
        "ahreas_ref": (ahreas_ref or "").strip() or None,
        "criado_por_nome": (solicitante or "WhatsApp"), "criado_por_email": cc_email,
    }).execute().data
    sv = ins[0] if ins else {}
    _log_sv_hist(db, sv.get("id"), "criacao", autor_nome=(solicitante or "WhatsApp"),
                 vencimento=venc, ref_mes=ref_mes, ref_ano=ref_ano,
                 modalidade=modalidade, email_destinatario=(email or "").strip() or None,
                 motivo=(obs or "").strip() or None)
    try:
        cnome = condo.get("name") or "Condomínio"
        for p in (db.table("profiles").select("id").in_("role", list(ROLES_SEGVIA_ATENDE)).execute().data or []):
            db.table("notificacoes").insert({
                "user_id": p["id"], "tipo": "segunda_via",
                "titulo": "Nova 2ª via (WhatsApp)",
                "mensagem": f"{cnome} · unidade {unidade} · {_MODALIDADE_LABEL.get(modalidade, modalidade)}.",
                "link": "/carteiras/segundas-vias",
            }).execute()
    except Exception as e:
        print(f"[integracao sv] notif: {e}")
    return sv


class IntegracaoSegundaViaSchema(BaseModel):
    condominio: str                      # código (ex '403') ou nome
    unidade: str
    bloco: Optional[str] = None
    ref_mes: Optional[int] = None
    ref_ano: Optional[int] = None
    modalidade: str = "com_multa"
    email_destinatario: Optional[str] = None
    observacoes: Optional[str] = None
    solicitante: Optional[str] = None    # quem pediu (WhatsApp)
    vencimento: Optional[str] = None
    ahreas_ref: Optional[str] = None

@router.post("/integracao/segundas-vias")
def api_integracao_criar_segunda_via(data: IntegracaoSegundaViaSchema, request: Request,
                                     _: bool = Depends(require_api_key), db: Client = Depends(get_db)):
    """n8n cria um pedido de 2ª via (vindo do WhatsApp). Cai na fila como pendente."""
    condo = _resolve_condominio(db, data.condominio)
    if not condo:
        raise HTTPException(404, f"Condomínio não encontrado: {data.condominio}")
    if data.modalidade not in ("com_multa", "sem_multa", "quinto_andar"):
        raise HTTPException(400, "Modalidade inválida.")
    if not (data.unidade and data.unidade.strip()):
        raise HTTPException(400, "Informe a unidade.")
    venc = data.vencimento
    if data.modalidade == "quinto_andar":
        import datetime
        minv = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
        if not venc or venc < minv:
            venc = minv
    sv = _criar_sv_integracao(db, condo, data.unidade, data.bloco, data.ref_mes, data.ref_ano,
                              data.modalidade, venc, data.email_destinatario, data.observacoes,
                              data.solicitante, data.ahreas_ref)
    return {"ok": True, "id": sv.get("id"), "condominio": condo.get("name")}

class IntegracaoBoletoSchema(BaseModel):
    id: Optional[str] = None             # id do pedido na nossa fila
    ahreas_ref: Optional[str] = None     # ou casa pelo ref do Ahreas
    boleto_url: Optional[str] = None     # caminho já no bucket
    boleto_base64: Optional[str] = None  # ou o PDF em base64
    boleto_nome: Optional[str] = None

@router.post("/integracao/segundas-vias/boleto")
def api_integracao_boleto(data: IntegracaoBoletoSchema, request: Request,
                          _: bool = Depends(require_api_key), db: Client = Depends(get_db)):
    """Boleto pronto (do Ahreas, via n8n): anexa ao pedido e ENVIA o e-mail automaticamente."""
    sv = None
    if data.id:
        sv = db.table("segundas_vias").select("*, condominios(name)").eq("id", data.id).maybe_single().execute().data
    elif data.ahreas_ref:
        r = db.table("segundas_vias").select("*, condominios(name)").eq("ahreas_ref", data.ahreas_ref).limit(1).execute().data
        sv = r[0] if r else None
    if not sv:
        raise HTTPException(404, "Pedido de 2ª via não encontrado (use id ou ahreas_ref).")

    boleto_url = data.boleto_url
    boleto_nome = data.boleto_nome or "boleto.pdf"
    if data.boleto_base64:
        import base64, time as _t
        try:
            pdf = base64.b64decode(data.boleto_base64)
            path = f"segundas-vias/boletos/{sv['condominio_id']}/{int(_t.time())}_{boleto_nome}"
            db.storage.from_("emissoes").upload(path, pdf, {"content-type": "application/pdf"})
            boleto_url = path
        except Exception as e:
            raise HTTPException(400, f"Falha ao gravar o boleto: {e}")
    if not boleto_url:
        raise HTTPException(400, "Envie boleto_base64 ou boleto_url.")

    email_enviado = _emitir_segunda_via(db, sv, boleto_url=boleto_url, boleto_nome=boleto_nome, enviar_email=True)
    return {"ok": True, "id": sv["id"], "email_enviado": email_enviado}


# ─── Chatbot guiado de 2ª via (o "cérebro" mora aqui; o n8n é só o cano do WhatsApp) ───
def _norm_cpf(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())

def _mascara_email(e):
    try:
        u, d = e.split("@", 1)
        um = (u[:2] + "***") if len(u) > 2 else (u[0] + "***")
        return f"{um}@{d}"
    except Exception:
        return "***"

def _cond_unidade_rows(db, condominio_id, unidade, bloco):
    """Linhas do cadastro de condôminos da unidade (filtra bloco se informado)."""
    try:
        rows = db.table("condominos").select("*").eq("condominio_id", condominio_id) \
            .ilike("unidade", (unidade or "").strip()).eq("ativo", True).execute().data or []
    except Exception as e:
        print(f"[cond_unidade] {e}")
        return []
    bl = (bloco or "").strip().upper()
    if bl:
        rows = [r for r in rows if (r.get("bloco") or "").strip().upper() == bl]
    return rows

def _verificar_condomino(db, condominio_id, unidade, bloco, cpf):
    """CPF é o responsável pelo pagamento da unidade? Retorna o registro ou None."""
    cpfd = _norm_cpf(cpf)
    if not (cpfd and condominio_id and unidade):
        return None
    for r in _cond_unidade_rows(db, condominio_id, unidade, bloco):
        if _norm_cpf(r.get("cpf")) == cpfd and r.get("responsavel_pagamento"):
            return r
    return None

def _contatos_unidade(db, condominio_id, unidade, bloco):
    """E-mails cadastrados da unidade (p/ escolher o destino), sem duplicar."""
    out, seen = [], set()
    for r in _cond_unidade_rows(db, condominio_id, unidade, bloco):
        email = (r.get("email") or "").strip()
        if email and email.lower() not in seen:
            seen.add(email.lower())
            out.append({"nome": r.get("nome"), "tipo": r.get("tipo"), "email": email})
    return out


# ─── Ferramentas do agente de IA (JARVIS 2ª via): verificação + criação seguras ───
# Desenho à prova de jailbreak: a IA conversa, mas QUEM decide segurança é o servidor.
# A IA só recebe e-mails MASCARADOS (com índice); nunca vê/escolhe o e-mail real,
# e o CPF é RE-VERIFICADO no servidor na hora de criar (dupla trava).
class VerificarCondominoSchema(BaseModel):
    condominio: str
    unidade: str
    bloco: Optional[str] = None
    cpf: str

@router.post("/integracao/verificar-condomino")
def api_integracao_verificar_condomino(data: VerificarCondominoSchema, request: Request,
                                       _: bool = Depends(require_api_key), db: Client = Depends(get_db)):
    """Tool do agente: o CPF é o responsável pelo pagamento da unidade?
    Retorna autorizado + e-mails MASCARADOS com índice (a IA nunca vê o e-mail real)."""
    condo = _resolve_condominio(db, data.condominio)
    if not condo:
        return {"autorizado": False, "motivo": "condominio_nao_encontrado"}
    cond = _verificar_condomino(db, condo["id"], data.unidade, data.bloco, data.cpf)
    if not cond:
        return {"autorizado": False, "motivo": "cpf_nao_responsavel"}
    contatos = _contatos_unidade(db, condo["id"], data.unidade, data.bloco)
    emails = [{"indice": i, "email_mascarado": _mascara_email(c["email"])} for i, c in enumerate(contatos)]
    return {
        "autorizado": True,
        "condominio": condo.get("name"),
        "condomino_nome": cond.get("nome"),
        "emails": emails,
    }

class CriarPedidoBotSchema(BaseModel):
    condominio: str
    unidade: str
    bloco: Optional[str] = None
    cpf: str
    email_indice: int = 0                 # índice devolvido por verificar-condomino
    ref_mes: Optional[int] = None
    ref_ano: Optional[int] = None
    modalidade: str = "com_multa"
    observacoes: Optional[str] = None

@router.post("/integracao/segundas-vias/bot")
def api_integracao_criar_pedido_bot(data: CriarPedidoBotSchema, request: Request,
                                    _: bool = Depends(require_api_key), db: Client = Depends(get_db)):
    """Tool do agente: cria o pedido APÓS RE-VERIFICAR o CPF no servidor (dupla trava).
    O e-mail vem por ÍNDICE — a IA nunca manda e-mail livre."""
    condo = _resolve_condominio(db, data.condominio)
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    cond = _verificar_condomino(db, condo["id"], data.unidade, data.bloco, data.cpf)
    if not cond:
        raise HTTPException(403, "Não autorizado: CPF não é o responsável pelo pagamento desta unidade.")
    if data.modalidade not in ("com_multa", "sem_multa", "quinto_andar"):
        raise HTTPException(400, "Modalidade inválida.")
    contatos = _contatos_unidade(db, condo["id"], data.unidade, data.bloco)
    if not contatos:
        raise HTTPException(400, "Nenhum e-mail cadastrado para esta unidade.")
    idx = data.email_indice if 0 <= (data.email_indice or 0) < len(contatos) else 0
    email = contatos[idx]["email"]
    venc = None
    if data.modalidade == "quinto_andar":
        import datetime
        venc = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    sv = _criar_sv_integracao(db, condo, data.unidade, data.bloco, data.ref_mes, data.ref_ano,
                              data.modalidade, venc, email, data.observacoes, (cond.get("nome") or "WhatsApp"))
    return {"ok": True, "protocolo": sv.get("id"), "email_destino": _mascara_email(email)}


def _wa_step(db, msg, nome, etapa, dados):
    """Máquina de estados do fluxo guiado (com verificação por CPF). Retorna (reply, etapa, dados, done)."""
    import re
    low = (msg or "").lower().strip()

    if etapa == "inicio":
        return ("Olá! 🐧 Sou o assistente da *Prop Starter*. Vou te ajudar a solicitar a *2ª via de um boleto*.\n\n"
                "Qual o *condomínio*? (código ou nome — ex.: 403 ou ITAPOLIS)", "condominio", dados, False)

    if etapa == "condominio":
        condo = _resolve_condominio(db, msg)
        if not condo:
            return ("Não encontrei esse condomínio 🤔. Manda de novo o *código* (ex.: 403) ou o nome.", "condominio", dados, False)
        dados["condominio_id"] = condo["id"]; dados["condominio_nome"] = condo.get("name")
        return (f"✅ {condo.get('name')}.\n\nQual a *unidade/apartamento*? (ex.: 71)", "unidade", dados, False)

    if etapa == "unidade":
        if not msg:
            return ("Me diz a *unidade* (ex.: 71).", "unidade", dados, False)
        dados["unidade"] = msg
        return ("Tem *bloco*? Qual? (ex.: A) — se não tiver, responda *não*.", "bloco", dados, False)

    if etapa == "bloco":
        dados["bloco"] = None if low in ("não", "nao", "n", "sem", "-") else msg
        return ("Por segurança, preciso confirmar quem você é. Qual o seu *CPF*? (só os números)", "cpf", dados, False)

    if etapa == "cpf":
        cond = _verificar_condomino(db, dados.get("condominio_id"), dados.get("unidade"), dados.get("bloco"), msg)
        if not cond:
            return ("❌ Não consegui confirmar: esse CPF não consta como *responsável pelo pagamento* dessa unidade.\n\n"
                    "Se você é o responsável, fale com a administração para atualizar seu cadastro. (Responda *menu* pra recomeçar.)",
                    "cpf", dados, False)
        dados["cpf"] = _norm_cpf(msg)
        dados["condomino_nome"] = cond.get("nome")
        contatos = _contatos_unidade(db, dados.get("condominio_id"), dados.get("unidade"), dados.get("bloco"))
        dados["contatos"] = contatos
        nm = cond.get("nome") or ""
        if len(contatos) == 0:
            dados["email_destinatario"] = None
            return (f"✅ Identidade confirmada{(', ' + nm) if nm else ''}. Mas não há *e-mail cadastrado* nessa unidade — "
                    "vou registrar o pedido e a administração entra em contato pra enviar com segurança.\n\n"
                    "De qual *mês/ano* é o boleto? (ex.: 06/2026)", "ref", dados, False)
        if len(contatos) == 1:
            dados["email_destinatario"] = contatos[0]["email"]
            return (f"✅ Confirmado{(', ' + nm) if nm else ''}. Vou enviar pro e-mail cadastrado: *{_mascara_email(contatos[0]['email'])}*.\n\n"
                    "De qual *mês/ano* é o boleto? (ex.: 06/2026)", "ref", dados, False)
        linhas = "\n".join(f"*{i+1})* {_mascara_email(c['email'])}  ({c.get('tipo') or 'contato'})" for i, c in enumerate(contatos))
        return (f"✅ Confirmado{(', ' + nm) if nm else ''}.\n\nPra qual e-mail *cadastrado* enviamos?\n{linhas}\n\nResponda o número.",
                "escolher_email", dados, False)

    if etapa == "escolher_email":
        contatos = dados.get("contatos") or []
        m = re.match(r"^\s*(\d+)\s*$", msg)
        if not m or not (1 <= int(m.group(1)) <= len(contatos)):
            return (f"Responda o *número* do e-mail (1 a {len(contatos)}).", "escolher_email", dados, False)
        dados["email_destinatario"] = contatos[int(m.group(1)) - 1]["email"]
        return ("De qual *mês/ano* é o boleto? (ex.: 06/2026)", "ref", dados, False)

    if etapa == "ref":
        m = re.match(r"^\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})\s*$", msg)
        if not m:
            return ("Formato inválido. Manda como *MM/AAAA* (ex.: 06/2026).", "ref", dados, False)
        mes = int(m.group(1)); ano = int(m.group(2)); ano = ano + 2000 if ano < 100 else ano
        if mes < 1 or mes > 12:
            return ("Mês inválido. Ex.: 06/2026.", "ref", dados, False)
        dados["ref_mes"] = mes; dados["ref_ano"] = ano
        return ("O boleto é:\n*1)* Com multa\n*2)* Sem multa\n*3)* Quinto Andar\n\nResponda 1, 2 ou 3.", "modalidade", dados, False)

    if etapa == "modalidade":
        mp = {"1": "com_multa", "2": "sem_multa", "3": "quinto_andar",
              "com multa": "com_multa", "sem multa": "sem_multa", "quinto andar": "quinto_andar"}
        mod = mp.get(low)
        if not mod:
            return ("Responda *1* (com multa), *2* (sem multa) ou *3* (Quinto Andar).", "modalidade", dados, False)
        dados["modalidade"] = mod
        extra = "\n\n⚠️ *Sem multa* precisa de autorização do síndico — nossa equipe vai confirmar." if mod == "sem_multa" else ""
        return (f"Alguma *observação*? (vencimento desejado etc.) — ou responda *não*.{extra}", "obs", dados, False)

    if etapa == "obs":
        dados["observacoes"] = None if low in ("não", "nao", "n", "-") else msg
        dest = dados.get("email_destinatario")
        resumo = ("Confere? 👇\n\n"
                  f"*Condomínio:* {dados.get('condominio_nome')}\n"
                  f"*Unidade:* {dados.get('unidade')}" + (f"   *Bloco:* {dados['bloco']}" if dados.get('bloco') else "") + "\n"
                  f"*Referência:* {int(dados['ref_mes']):02d}/{dados['ref_ano']}\n"
                  f"*Modalidade:* {_MODALIDADE_LABEL.get(dados.get('modalidade'), '')}\n"
                  f"*E-mail:* {(_mascara_email(dest) if dest else 'a definir pela administração')}\n"
                  + (f"*Obs:* {dados['observacoes']}\n" if dados.get('observacoes') else "")
                  + "\nResponda *sim* pra confirmar ou *não* pra recomeçar.")
        return (resumo, "confirma", dados, False)

    if etapa == "confirma":
        if low in ("sim", "s", "confirmar", "ok", "isso", "pode"):
            condo = {"id": dados.get("condominio_id"), "name": dados.get("condominio_nome")}
            venc = None
            if dados.get("modalidade") == "quinto_andar":
                import datetime
                venc = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
            solic = f"{nome or ''} (CPF {dados.get('cpf', '')[-4:].rjust(4, '*')})".strip()
            sv = _criar_sv_integracao(db, condo, dados.get("unidade"), dados.get("bloco"),
                                      dados.get("ref_mes"), dados.get("ref_ano"), dados.get("modalidade"),
                                      venc, dados.get("email_destinatario"), dados.get("observacoes"), solic)
            proto = (sv.get("id") or "")[:8]
            return (f"✅ Pedido registrado! Protocolo *#{proto}*.\nNossa equipe vai emitir o boleto e enviar pro e-mail cadastrado. Obrigado! 🐧",
                    "feito", {}, True)
        if low in ("não", "nao", "n", "cancelar"):
            return ("Sem problema — vamos recomeçar.\n\nQual o *condomínio*? (código ou nome)", "condominio", {}, False)
        return ("Responda *sim* pra confirmar ou *não* pra recomeçar.", "confirma", dados, False)

    return ("Vamos começar. Qual o *condomínio*? (código ou nome)", "condominio", {}, False)

class WaMsgSchema(BaseModel):
    phone: str
    nome: Optional[str] = None
    mensagem: str

@router.post("/integracao/wa")
def api_integracao_wa(data: WaMsgSchema, request: Request, _: bool = Depends(require_api_key), db: Client = Depends(get_db)):
    """Recebe uma mensagem do WhatsApp (via n8n), avança o fluxo guiado e devolve a resposta."""
    import datetime
    phone = (data.phone or "").strip()
    if not phone:
        raise HTTPException(400, "phone obrigatório")
    msg = (data.mensagem or "").strip()
    conv = db.table("wa_conversas").select("*").eq("phone", phone).maybe_single().execute().data
    etapa = (conv or {}).get("etapa") or "inicio"
    dados = (conv or {}).get("dados") or {}
    if msg.lower() in ("cancelar", "menu", "recomecar", "recomeçar", "sair", "oi", "olá", "ola", "inicio", "início"):
        etapa, dados = "inicio", {}
    reply, etapa, dados, done = _wa_step(db, msg, data.nome, etapa, dados)
    if done:
        db.table("wa_conversas").delete().eq("phone", phone).execute()
    else:
        db.table("wa_conversas").upsert({
            "phone": phone, "etapa": etapa, "dados": dados,
            "atualizado_em": datetime.datetime.utcnow().isoformat(),
        }).execute()
    return {"reply": reply, "etapa": etapa, "done": done}


class WaSimulacaoSchema(BaseModel):
    mensagem: str
    etapa: Optional[str] = "inicio"
    dados: Optional[dict] = None


@router.post("/integracao/wa/simular")
def api_simular_wa(data: WaSimulacaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Roda o MESMO `_wa_step` do WhatsApp, mas autenticado pelo site e sem persistir
    conversa — serve para ver o fluxo funcionando (e onde ele trava) sem depender do
    n8n nem da Meta.

    Só o master, porque a conversa expõe e-mails mascarados de moradores. A etapa
    'confirma' é bloqueada: simular não pode criar uma 2ª via de verdade.
    """
    if user["role"] != "master":
        raise HTTPException(403, "Apenas o master pode simular o atendimento.")
    etapa = data.etapa or "inicio"
    dados = data.dados or {}
    if etapa == "confirma" and (data.mensagem or "").strip().lower() in ("sim", "s", "ok", "confirmar", "isso", "pode"):
        return {"reply": "🧪 Simulação: aqui o pedido seria registrado de verdade. "
                         "Para criar de fato, use o WhatsApp.", "etapa": "feito", "dados": {}, "done": True}
    try:
        reply, etapa2, dados2, done = _wa_step(db, data.mensagem or "", "Simulação", etapa, dados)
    except Exception as e:
        raise HTTPException(400, f"O fluxo quebrou em '{etapa}': {e}")
    return {"reply": reply, "etapa": etapa2, "dados": dados2, "done": done}
