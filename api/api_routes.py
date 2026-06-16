import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, Request, UploadFile, File # type: ignore
from supabase import create_client, Client # type: ignore
from pydantic import BaseModel # type: ignore
from auth_constants import (
    APPROVE_DOCUMENT, EMIT_DOCUMENT, EDIT_COBRANCAS_EXTRAS,
    DASHBOARD_FILTER_GERENTE, MANAGE_USERS, PIPELINE_OVERRIDE, VIEW_AUDITORIA,
    has_role,
)

router = APIRouter()

# Supabase Client setup
SB_URL = os.getenv("SUPABASE_URL", "")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY", "")

_db_client = None

def get_db() -> Client:
    global _db_client
    if _db_client is None:
        _db_client = create_client(SB_URL, SB_SERVICE)
    return _db_client

# ═══ Dependency: Authentication via JWT ══════════════════════════════
def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token JWT ausente ou inválido")
    
    token = authorization.split(" ")[1]
    db = get_db()
    
    # Valida token com o Supabase Auth
    user_res = db.auth.get_user(token)
    if not user_res or not user_res.user:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
        
    user_id = user_res.user.id
    
    # Busca profile
    prof_res = db.table("profiles").select("*").eq("id", user_id).single().execute()
    profile = prof_res.data if prof_res.data else {}
    
    return {
        "id": user_id,
        "email": user_res.user.email,
        "role": profile.get("role", "gerente"),
        "full_name": profile.get("full_name", ""),
        "must_change_password": bool(profile.get("must_change_password", False)),
    }

def get_gerente_id(db: Client, profile_id: str) -> Optional[str]:
    res = db.table("gerentes").select("id").eq("profile_id", profile_id).execute()
    if res.data:
        return res.data[0]["id"]
    return None

def gerente_condo_ids(db: Client, profile_id: str):
    """IDs dos condomínios sob a gerência do usuário (lista vazia se não for gerente / sem condos)."""
    g_id = get_gerente_id(db, profile_id)
    if not g_id:
        return []
    res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
    return [c["id"] for c in (res.data or [])]

def carteira_gerente_id(db: Client, user: dict):
    """gerentes.id da carteira do usuário — gerente: a sua; assistente: a do gerente vinculado."""
    role = user.get("role")
    if role == "gerente":
        return get_gerente_id(db, user["id"])
    if role == "assistente":
        try:
            prof = db.table("profiles").select("gerente_id").eq("id", user["id"]).maybeSingle().execute()
            gpid = (prof.data or {}).get("gerente_id")
        except Exception:
            gpid = None  # coluna ainda não existe (migration 0057 não rodada)
        return get_gerente_id(db, gpid) if gpid else None
    return None

def carteira_condo_ids(db: Client, user: dict):
    """IDs dos condomínios da carteira do usuário (gerente ou assistente vinculado)."""
    g_id = carteira_gerente_id(db, user)
    if not g_id:
        return []
    res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
    return [c["id"] for c in (res.data or [])]

# ═══ API ENDPOINTS ═══════════════════════════════════════════════════

@router.get("/health")
def api_health():
    # Endpoint leve (sem auth, sem DB) só para "acordar" a função e tirar o cold start.
    return {"ok": True}

@router.get("/dashboard")
def api_dashboard(gerente_id: Optional[str] = None, mes: Optional[int] = None, ano: Optional[int] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        from datetime import datetime
        year = datetime.now().year
        sem = 1 if datetime.now().month <= 6 else 2
        emis_ano = int(ano) if ano else year

        query = db.table("condominios").select("*, processos(*)")
        
        # Filtros baseados na role
        if user["role"] in ("gerente", "assistente"):
            g_id = carteira_gerente_id(db, user)
            query = query.eq("gerente_id", g_id or "00000000-0000-0000-0000-000000000000")
        elif gerente_id and user["role"] in DASHBOARD_FILTER_GERENTE:
            query = query.eq("gerente_id", gerente_id)
            
        raw_condos = query.execute().data
        
        condos = []
        processos = {}
        stats = {"total": len(raw_condos), "em_edicao": 0, "pendentes": 0, "aprovados": 0}
        
        for c in raw_condos:
            procs = c.pop("processos", [])
            proc = next((p for p in procs if p["year"] == year and p["semester"] == sem), None)
            if proc:
                processos[c["id"]] = proc
                st = proc["status"]
                if st in ["Em edição", "Solicitar alteração"]: stats["em_edicao"] += 1
                elif st in ["Enviado", "Em aprovação"]: stats["pendentes"] += 1
                elif st in ["Aprovado", "Emitido"]: stats["aprovados"] += 1
            else:
                stats["em_edicao"] += 1
                
            condos.append(c)
            
        gerentes = []
        if user["role"] != "gerente":
            # inclui o campo 'nome' direto da tabela gerentes pra cobrir os "ghosts" (sem profile)
            try:
                gerentes = db.table("gerentes").select("id, nome, profiles!gerentes_profile_id_fkey(full_name)").execute().data
            except Exception as e:
                print(f"[dashboard] gerentes falhou (segue sem): {e}")

        # ── Emissões: stats agregados + status mais recente por condomínio ──
        condo_ids = [c["id"] for c in raw_condos]
        emissao_stats = {"gerente": 0, "supGerente": 0, "supContabilidade": 0, "aguardando": 0, "registrada": 0}
        emissao_by_condo = {}
        if condo_ids:
            pacotes_q = db.table("emissoes_pacotes").select("status, condominio_id, criado_em, mes_referencia, ano_referencia") \
                .in_("condominio_id", condo_ids) \
                .order("criado_em", desc=True)
            # Filtra a emissão pelo mês selecionado (status daquele mês, não o último de todos)
            if mes:
                pacotes_q = pacotes_q.eq("mes_referencia", int(mes)).eq("ano_referencia", emis_ano)
            try:
                pacotes = pacotes_q.execute().data or []
            except Exception as e:
                print(f"[dashboard] emissoes_pacotes falhou (segue sem): {e}")
                pacotes = []
            for p in pacotes:
                s = (p.get("status") or "").lower()
                if "gerente" in s or s == "pendente": emissao_stats["gerente"] += 1
                elif "chefe" in s or "sup. gerentes" in s: emissao_stats["supGerente"] += 1
                elif "supervisor" in s: emissao_stats["supContabilidade"] += 1
                elif s == "aprovado": emissao_stats["aguardando"] += 1
                elif s == "registrado": emissao_stats["registrada"] += 1
                cid = p.get("condominio_id")
                if cid and cid not in emissao_by_condo:
                    emissao_by_condo[cid] = p.get("status") or "sem_processo"

        # ── Pipeline config do ano corrente (tolera ausência da tabela) ──
        pipeline_config = None
        try:
            pipeline_res = db.table("pipeline_config").select("*").eq("ano", year).limit(1).execute()
            pipeline_config = (pipeline_res.data or [None])[0]
        except Exception as e:
            print(f"[dashboard] pipeline_config falhou (segue sem): {e}")

        return {
            "year": year,
            "semester": sem,
            "stats": stats,
            "condos": condos,
            "processos": processos,
            "gerentes": gerentes,
            "emissao_stats": emissao_stats,
            "emissao_by_condo": emissao_by_condo,
            "emissao_mes": int(mes) if mes else None,
            "emissao_ano": emis_ano,
            "pipeline_config": pipeline_config,
        }
    except Exception as e:
        print(f"ERROR /dashboard: {e}")
        raise HTTPException(500, str(e))


class EmailHookSchema(BaseModel):
    to: str
    subject: str
    html: str

@router.post("/notificacoes/email-hook")
def api_email_hook(data: EmailHookSchema, request: Request):
    """Envia e-mail via SMTP (Gmail). Chamado pelo banco (pg_net) com o segredo no header.
    NÃO usa get_current_user — é protegido pelo header x-notif-secret."""
    import os, smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    secret = os.getenv("NOTIF_EMAIL_SECRET")
    if not secret or request.headers.get("x-notif-secret") != secret:
        raise HTTPException(401, "unauthorized")

    smtp_user = os.getenv("SMTP_USER") or os.getenv("GMAIL_USER")
    smtp_pass = os.getenv("SMTP_PASS") or os.getenv("GMAIL_APP_PASSWORD")
    if not smtp_user or not smtp_pass:
        return {"ok": False, "reason": "SMTP não configurado (defina GMAIL_USER e GMAIL_APP_PASSWORD)"}

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    from_name = os.getenv("EMAIL_FROM_NAME", "CondoFlow")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = data.subject
    msg["From"] = f"{from_name} <{smtp_user}>"
    msg["To"] = data.to
    msg.attach(MIMEText(data.html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(host, port, timeout=15) as s:
            s.login(smtp_user, smtp_pass)
            s.sendmail(smtp_user, [data.to], msg.as_string())
        return {"ok": True}
    except Exception as e:
        print(f"[email-hook] erro ao enviar para {data.to}: {e}")
        raise HTTPException(500, "falha no envio de e-mail")


@router.get("/condominios")
def api_condominios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Puxa os condomínios (sem join complexo para evitar travamentos)
        query = db.table("condominios").select("*").order("name")
        
        if user["role"] in ("gerente", "assistente"):
            g_id = carteira_gerente_id(db, user)
            query = query.eq("gerente_id", g_id or "00000000-0000-0000-0000-000000000000")
                
        condos = query.execute().data or []
        
        # Mapeamento de nomes de gerentes de forma estável
        try:
            # Puxa todos os gerentes e profiles para o De-para (leitura rápida)
            # gerente.nome cobre os "ghosts" (sem profile); profile.full_name cobre os com login
            gerentes_res = db.table("gerentes").select("id, profile_id, nome").execute().data or []
            profiles_res = db.table("profiles").select("id, full_name").execute().data or []

            p_map = {p["id"]: p["full_name"] for p in profiles_res}
            g_map = {
                g["id"]: p_map.get(g["profile_id"]) or g.get("nome") or "Gerente desconhecido"
                for g in gerentes_res
            }
            
            for c in condos:
                c["gerente_name"] = g_map.get(c.get("gerente_id"), "Gerente não definido")
        except Exception as inner_e:
            print(f"Erro ao mapear gerentes: {inner_e}")
            for c in condos:
                c["gerente_name"] = "Gerente não definido"
                
        return {"condos": condos}
    except Exception as e:
        print(f"Erro crítico /condominios: {e}")
        raise HTTPException(500, str(e))

class CondoData(BaseModel):
    id: Optional[str] = None
    name: str
    due_day: str
    due_day_2: Optional[str] = None
    gerente_id: str
    assistente: str
    fluxo: int = 1

@router.post("/condominios/salvar")
def api_salvar_condominio(data: CondoData, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] != "master":
            raise HTTPException(403, "Apenas master")
        
        payload = {"name": data.name, "due_day": data.due_day, "due_day_2": (data.due_day_2 or None), "gerente_id": data.gerente_id, "assistente": data.assistente, "fluxo": data.fluxo}
        
        if data.id:
            db.table("condominios").update(payload).eq("id", data.id).execute()
        else:
            db.table("condominios").insert(payload).execute()
            
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))

@router.get("/carteiras")
def api_carteiras(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Puxa todos os gerentes e seus condomínios vinculados
        query = db.table("gerentes").select("id, profiles(full_name), condominios(*)")
        res = query.execute().data
        
        # Mapa de assistentes conhecidos
        mapa_assistentes = {
            "Aline": "Vânia",
            "Eduardo": "Mayara",
            "Diogo": "Renata",
            "Marlei": "Sem Associação",
            "Mauro Jr": "Sem Associação"
        }
        
        carteiras = []
        for row in res:
            condos = row.get("condominios", [])
            gerente_full = row.get('profiles', {}).get('full_name', 'Sem Nome')
            
            primeiro_nome = gerente_full.split(" ")[0] if gerente_full else ""
            
            assistente = ""
            if condos and condos[0].get("assistente"):
                assistente = condos[0].get("assistente")
            else:
                assistente = mapa_assistentes.get(primeiro_nome, "—")

            carteiras.append({
                "nome": gerente_full,
                "assistente": assistente,
                "count": len(condos),
                "condominios": condos
            })
                
        return {"carteiras": carteiras}
    except Exception as e:
        print(f"CRITICAL ERROR /carteiras: {e}")
        return {"carteiras": [], "error": str(e)}

@router.get("/aprovacoes")
def api_aprovacoes(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        role = user.get('role')
        
        query = db.table("processos").select("id, year, semester, status, condominio_id, emitido_por, condominios(name)")
        
        if role in ROLES_APROVADORES or role == 'supervisor_gerentes':
            status_target = []
            if role == 'master':
                pass
            elif role == 'gerente':
                status_target = ['Aguardando Gerente']
            elif role == 'supervisora':
                status_target = ['Aguardando Supervisora']
            elif role == 'supervisora_contabilidade':
                status_target = ['Aguardando Sp. Contabilidade']
            elif role == 'supervisor_gerentes':
                status_target = ['Aguardando Sup. Gerentes']
                
            if status_target:
                query = query.in_("status", status_target)
            else:
                query = query.like("status", "Aguardando%")

            # Gerente vê só dos condomínios dele
            if role == 'gerente':
                g_id = get_gerente_id(db, user['id'])
                if g_id:
                    condos_res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
                    condo_ids = [c['id'] for c in (condos_res.data or [])]
                    if condo_ids:
                        query = query.in_("condominio_id", condo_ids)
                    else:
                        query = query.in_("condominio_id", ["00000000-0000-0000-0000-000000000000"]) # Retorna nada
        elif role in ['emissor', 'assistente', 'departamento']:
            query = query.eq("status", "Solicitar alteração")
            
        pendentes_res = query.execute().data
        
        # historico
        hist_res = db.table("aprovacoes").select("id, action, comment, created_at, profiles(full_name), processos(year, semester, condominios(name))").order('created_at', desc=True).limit(20).execute().data
        
        return {
            "pendentes": pendentes_res or [],
            "historico": hist_res or []
        }
    except Exception as e:
        print(f"CRITICAL ERROR /aprovacoes: {e}")
        return {"pendentes": [], "historico": [], "error": str(e)}

@router.get("/auditoria")
def api_auditoria(
    condo_id: str = None,
    gerente_id: str = None,
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    limit: int = 60,
    offset: int = 0,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    try:
        if user["role"] not in VIEW_AUDITORIA and user["role"] != 'gerente':
            raise HTTPException(403, "Acesso negado")

        query = db.table("aprovacoes").select(
            "id, action, comment, created_at, "
            "approver:approver_id(full_name), "
            "processo:processo_id(id, year, semester, condominio_id, status, "
            "condominios(id, name, gerente_id, gerentes:gerente_id(profiles!gerentes_profile_id_fkey(full_name))))"
        ).order("created_at", desc=True)

        if date_from:
            query = query.gte("created_at", date_from)
        if date_to:
            query = query.lte("created_at", date_to + "T23:59:59")

        query = query.range(offset, offset + limit - 1)
        result = query.execute()
        logs = result.data or []

        # Filtros client-side (FK aninhada)
        if condo_id:
            logs = [l for l in logs if (l.get("processo") or {}).get("condominio_id") == condo_id]
        if gerente_id:
            logs = [l for l in logs if (((l.get("processo") or {}).get("condominios") or {}).get("gerente_id")) == gerente_id]
        if search:
            s = search.lower()
            logs = [l for l in logs if
                s in (l.get("action") or "").lower() or
                s in (l.get("comment") or "").lower() or
                s in ((l.get("approver") or {}).get("full_name") or "").lower() or
                s in (((l.get("processo") or {}).get("condominios") or {}).get("name") or "").lower()
            ]

        # Contagens para stats
        total_res = db.table("aprovacoes").select("id", count="exact", head=True).execute()

        import datetime
        hoje = datetime.date.today().isoformat()
        hoje_res = db.table("aprovacoes").select("id", count="exact", head=True).gte("created_at", hoje).execute()

        return {
            "logs": logs,
            "total": total_res.count or 0,
            "hoje": hoje_res.count or 0,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"CRITICAL ERROR /auditoria: {e}")
        return {"logs": [], "total": 0, "hoje": 0, "error": str(e)}

class RateioUpdate(BaseModel):
    ano: int
    obs_emissao: str
    rateios: list
    rateios_vals: dict

@router.post("/condominio/{condo_id}/arrecadacoes/salvar")
def api_salvar_arrecadacoes(condo_id: str, data: RateioUpdate, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Aqui vai a lógica de salvar os rateios_config e rateios_valores, além do obs_emissao
        db.table("condominios").update({"obs_emissao": data.obs_emissao}).eq("id", condo_id).execute()
        
        for rat in data.rateios:
            rid = rat.get("id")
            payload = {k: v for k, v in rat.items() if k != "id"}
            payload["condominio_id"] = condo_id
            
            if str(rid).startswith("new_"):
                res = db.table("rateios_config").insert(payload).execute()
                if res.data:
                    rid = res.data[0]["id"]
            else:
                db.table("rateios_config").update(payload).eq("id", rid).execute()
                
            # Salva os valores mensais
            vals = data.rateios_vals.get(str(rid), {}) if str(rid) in data.rateios_vals else data.rateios_vals.get(rid, {})
            for mes, valor in vals.items():
                db.table("rateios_valores").upsert({
                    "rateio_id": rid,
                    "ano": data.ano,
                    "month": int(mes),
                    "valor": str(valor)
                }).execute()

        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))

@router.get("/condominio/{condo_id}/arrecadacoes")
def api_get_arrecadacoes(condo_id: str, ano: int, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        from datetime import datetime
        sem = 1 if datetime.now().month <= 6 else 2
        
        condo = db.table("condominios").select("*").eq("id", condo_id).single().execute().data
        
        # Processo do semestre
        p_res = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()
        processo = p_res.data[0] if p_res.data else None
        
        # Obter rateios
        rateios = db.table("rateios_config").select("*").eq("condominio_id", condo_id).order("ordem").execute().data
        
        rateios_vals = {}
        if rateios:
            r_ids = [r["id"] for r in rateios]
            vals = db.table("rateios_valores").select("*").in_("rateio_id", r_ids).eq("ano", ano).execute().data
            for v in vals:
                if v["rateio_id"] not in rateios_vals:
                    rateios_vals[v["rateio_id"]] = {}
                rateios_vals[v["rateio_id"]][v["month"]] = v["valor"]
                
        return {"condo": condo, "processo": processo, "rateios": rateios, "rateios_vals": rateios_vals}
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── Preencher consumos (água/gás/energia) na planilha a partir dos anexos da emissão ───
def _norm_txt(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', (s or '')) if unicodedata.category(c) != 'Mn').upper()

def _servico_rateio(nome):
    n = _norm_txt(nome)
    if 'AGUA' in n: return 'agua'
    if 'GAS' in n: return 'gas'
    if 'ENERGIA' in n or 'ELETRIC' in n or 'LUZ' in n or 'ENEL' in n: return 'energia'
    return None

def _consumos_do_pacote(db: Client, pacote_id: str):
    """Valor por serviço a partir dos anexos do pacote: relatório de leitura tem
    prioridade; se não houver, usa a conta da concessionária (SABESP/COMGÁS/ENEL)."""
    arqs = db.table("emissoes_arquivos").select(
        "categoria, subtipo, relatorio_tipo_servico, relatorio_valor_total, valor_fatura"
    ).eq("pacote_id", pacote_id).execute().data or []
    rel = {'agua': 0.0, 'gas': 0.0, 'energia': 0.0}
    fat = {'agua': 0.0, 'gas': 0.0, 'energia': 0.0}
    for a in arqs:
        cat = a.get('categoria')
        if cat == 'relatorio_leitura':
            ts = (a.get('relatorio_tipo_servico') or '').lower()
            v = float(a.get('relatorio_valor_total') or 0)
            rel['gas' if 'gas' in ts or 'gás' in ts else 'agua'] += v
        elif cat == 'concessionaria':
            st = _norm_txt(a.get('subtipo'))
            v = float(a.get('valor_fatura') or 0)
            if 'SABESP' in st: fat['agua'] += v
            elif 'COMGAS' in st: fat['gas'] += v
            elif 'ENEL' in st or 'ELETROPAULO' in st or 'ENERGIA' in st: fat['energia'] += v
    return {s: round(rel[s] if rel[s] > 0 else fat[s], 2) for s in ('agua', 'gas', 'energia')}

@router.get("/condominio/{condo_id}/consumos-planilha")
def api_consumos_planilha_preview(condo_id: str, pacote_id: str, mes: int, ano: int,
                                  user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user.get("role") not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor")
    consumos = _consumos_do_pacote(db, pacote_id)
    rateios = db.table("rateios_config").select("id, nome, ordem").eq("condominio_id", condo_id).order("ordem").execute().data or []
    r_ids = [r["id"] for r in rateios]
    atuais = {}
    if r_ids:
        vals = db.table("rateios_valores").select("rateio_id, valor").in_("rateio_id", r_ids).eq("month", int(mes)).eq("ano", int(ano)).execute().data or []
        for v in vals:
            atuais[v["rateio_id"]] = float(v.get("valor") or 0)
    linhas = []
    for r in rateios:
        serv = _servico_rateio(r["nome"])
        if not serv:
            continue
        novo = consumos.get(serv, 0)
        if novo <= 0:
            continue
        linhas.append({
            "rateio_id": r["id"], "nome": r["nome"], "servico": serv,
            "atual": atuais.get(r["id"], 0), "novo": novo,
        })
    return {"linhas": linhas}

class PreencherConsumosBody(BaseModel):
    mes: int
    ano: int
    itens: list

@router.post("/condominio/{condo_id}/consumos-planilha")
def api_consumos_planilha_aplicar(condo_id: str, data: PreencherConsumosBody,
                                  user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user.get("role") not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor")
    aplicados = 0
    for it in (data.itens or []):
        rid = it.get("rateio_id")
        if not rid:
            continue
        valor = float(it.get("valor") or 0)
        existing = db.table("rateios_valores").select("id").eq("rateio_id", rid).eq("month", int(data.mes)).eq("ano", int(data.ano)).maybeSingle().execute()
        if existing.data:
            db.table("rateios_valores").update({"valor": valor}).eq("id", existing.data["id"]).execute()
        else:
            db.table("rateios_valores").insert({"rateio_id": rid, "month": int(data.mes), "ano": int(data.ano), "valor": valor}).execute()
        aplicados += 1
    return {"ok": True, "aplicados": aplicados}


@router.get("/condominio/{condo_id}/ultima-emissao")
def api_ultima_emissao(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Busca o arquivo mais recente deste condomínio
        res = db.table("emissoes_arquivos").select("*").eq("condominio_id", condo_id).order("criado_em", desc=True).limit(1).execute()
        
        if not res.data:
            return {"file": None}
            
        file_data = res.data[0]
        
        # Gera Signed URL
        signed_res = db.storage.from_('emissoes').create_signed_url(file_data["arquivo_url"], 300)
        
        # A lib do Supabase às vezes retorna dict ou string dependendo da implementação/mock
        url = signed_res.get("signedURL") if isinstance(signed_res, dict) else signed_res
        
        return {
            "file": {
                "id": file_data["id"],
                "name": file_data["arquivo_nome"],
                "format": file_data["formato"],
                "url": url,
                "status": file_data["status"]
            }
        }
    except Exception as e:
        print(f"Error /ultima-emissao: {e}")
        return {"file": None, "error": str(e)}

@router.get("/usuarios")
def api_usuarios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403)
    usuarios = db.table("profiles").select("*").order("full_name").execute().data
    return {"usuarios": usuarios}




class ForceStatusSchema(BaseModel):
    status: str
    year: int = None

@router.post("/condominio/{condo_id}/processo/force")
def api_condo_process_status_force(condo_id: str, data: ForceStatusSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] not in ROLES_EMISSORES:
            raise HTTPException(403, "Apenas emissor ou master podem forçar o status")
            
        import datetime
        now = datetime.datetime.now()
        ano = data.year or now.year
        sem = 1 if now.month <= 6 else 2
        
        # Check if process exists
        proc_res = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()
        
        if not proc_res.data:
            # Create process
            new_proc = db.table("processos").insert({
                "condominio_id": condo_id,
                "year": ano,
                "semester": sem,
                "status": data.status
            }).execute()
            processo_id = new_proc.data[0]["id"]
        else:
            # Update process
            processo_id = proc_res.data[0]["id"]
            db.table("processos").update({
                "status": data.status
            }).eq("id", processo_id).execute()
        
        # Log action
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user["id"],
            "action": f"Status forçado para: {data.status} (Início s/ rascunho)",
            "comment": "Timeline acionada pelo Emissor"
        }).execute()
        
        # Return the updated/created process
        final_proc = db.table("processos").select("*").eq("id", processo_id).single().execute()
        return {"success": True, "processo": final_proc.data}
    except Exception as e:
        print("ERROR forcing status:", e)
        raise HTTPException(400, str(e))

@router.post("/processo/{processo_id}/status/force")
def api_processo_status_force(processo_id: str, data: ForceStatusSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] not in ROLES_EMISSORES:
            raise HTTPException(403, "Apenas emissor ou master podem forçar o status")
        
        proc_res = db.table("processos").select("*").eq("id", processo_id).single().execute()
        if not proc_res.data:
            raise HTTPException(404, "Processo não encontrado")
            
        db.table("processos").update({
            "status": data.status
        }).eq("id", processo_id).execute()
        
        # Log action
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user["id"],
            "action": f"Status alterado para: {data.status}",
            "comment": "Alteração manual pelo Emissor"
        }).execute()
        
        return {"success": True, "new_status": data.status}
    except Exception as e:
        raise HTTPException(400, str(e))

class PipelineForceAllSchema(BaseModel):
    status: str
    ano: int = None
    semestre: int = None
    gerente_id: str = None

@router.post("/pipeline/force-all")
def api_pipeline_force_all(data: PipelineForceAllSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] != "master":
            raise HTTPException(403, "Apenas master pode forçar status global")

        import datetime
        now = datetime.datetime.now()
        ano = data.ano or now.year
        sem = data.semestre or (1 if now.month <= 6 else 2)

        # Buscar condomínios (todos ou filtrado por gerente)
        query = db.table("condominios").select("id")
        if data.gerente_id:
            query = query.eq("gerente_id", data.gerente_id)
        condos_res = query.execute()
        condos = condos_res.data or []

        updated = 0
        for condo in condos:
            condo_id = condo["id"]
            # Verificar se já existe processo para este condo/ano/semestre
            proc_res = db.table("processos").select("id").eq("condominio_id", condo_id).eq("year", ano).eq("semester", sem).execute()

            if not proc_res.data:
                # Criar processo novo
                new_proc = db.table("processos").insert({
                    "condominio_id": condo_id,
                    "year": ano,
                    "semester": sem,
                    "status": data.status
                }).execute()
                processo_id = new_proc.data[0]["id"] if new_proc.data else None
            else:
                processo_id = proc_res.data[0]["id"]
                db.table("processos").update({"status": data.status}).eq("id", processo_id).execute()

            if processo_id:
                try:
                    db.table("aprovacoes").insert({
                        "processo_id": processo_id,
                        "approver_id": user["id"],
                        "action": f"Status forçado globalmente para: {data.status}",
                        "comment": "Painel de Controle Global — master"
                    }).execute()
                except Exception:
                    pass
                updated += 1

        return {"success": True, "updated": updated}
    except HTTPException:
        raise
    except Exception as e:
        print("ERROR pipeline force-all:", e)
        raise HTTPException(400, str(e))


class CreateUserSchema(BaseModel):
    email: str
    password: str
    full_name: str
    role: str
    gerente_id: Optional[str] = None  # profile do gerente responsável (quando role=assistente)

@router.post("/usuarios")
def api_criar_usuario(data: CreateUserSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem criar usuários")
    
    if not SB_SERVICE:
        raise HTTPException(500, "SUPABASE_SERVICE_KEY não configurada no servidor. Contate o suporte.")

    try:
        # 1. Tentar criar no Auth usando admin
        uid = None
        try:
            # Verifica se o admin client está disponível
            if not hasattr(db.auth, 'admin') or db.auth.admin is None:
                raise Exception("SDK Admin não inicializado corretamente. Verifique a SERVICE_KEY.")

            auth_res = db.auth.admin.create_user({
                "email": data.email,
                "password": data.password,
                "email_confirm": True
            })
            
            if hasattr(auth_res, 'user') and auth_res.user:
                uid = str(auth_res.user.id)
            else:
                raise Exception("A resposta do Supabase não conteve os dados do usuário criado.")

        except Exception as auth_e:
            err_msg = str(auth_e)
            if "already" in err_msg.lower() or "registered" in err_msg.lower():
                try:
                    users = db.auth.admin.list_users()
                    user_list = users if isinstance(users, list) else getattr(users, 'users', [])
                    target = next((u for u in user_list if u.email == data.email), None)
                    if target:
                        uid = str(target.id)
                    else:
                        raise Exception(f"Usuário já existe mas não pôde ser localizado: {err_msg}")
                except:
                    raise Exception(f"O e-mail {data.email} já está em uso.")
            else:
                raise Exception(f"Erro no Supabase Auth: {err_msg}")

        if not uid:
            raise Exception("Não foi possível gerar ou recuperar o ID do usuário.")

        # 2. Criar ou Atualizar no Profiles (senha temporária — forçar troca no 1º acesso)
        profile_payload = {
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role,
            "must_change_password": True,
        }
        if data.role == 'assistente':
            profile_payload["gerente_id"] = data.gerente_id or None
        db.table("profiles").upsert(profile_payload).execute()

        # 3. Se for gerente: tentar vincular a um gerente-fantasma existente
        # (importado do Ahreas com nome igual mas sem profile_id ainda).
        # Caso não exista, cria novo gerente.
        if data.role == 'gerente':
            ghost = db.table("gerentes").select("id").is_("profile_id", "null") \
                .ilike("nome", data.full_name).limit(1).execute().data
            if ghost:
                db.table("gerentes").update({"profile_id": uid, "nome": data.full_name}) \
                    .eq("id", ghost[0]["id"]).execute()
            else:
                db.table("gerentes").upsert(
                    {"profile_id": uid, "nome": data.full_name},
                    on_conflict="profile_id"
                ).execute()

        return {"success": True, "uid": uid}
        
    except Exception as e:
        print(f"CRITICAL ERROR CREATE_USER: {e}")
        raise HTTPException(status_code=400, detail=str(e))

class VincularGerenteSchema(BaseModel):
    assistente_id: str            # profile do assistente
    gerente_id: Optional[str] = None  # profile do gerente (None = desvincular)

@router.post("/usuarios/vincular-gerente")
def api_vincular_gerente(data: VincularGerenteSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores")
    db.table("profiles").update({"gerente_id": data.gerente_id or None}).eq("id", data.assistente_id).execute()
    return {"success": True}

class SyncUserSchema(BaseModel):
    email: str
    password: str
    full_name: str
    role: str
    profile_id: Optional[str] = None

@router.post("/usuarios/sync")
def api_sync_usuario(data: SyncUserSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Repara ou Reseta um usuário existente (como o Diogo)"""
    if user["role"] != "master":
        raise HTTPException(403)
    
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        # Tenta criar no Auth (pode falhar se já existir, mas o admin.create_user costuma dar erro se duplicado)
        # O objetivo aqui é garantir que existe no Auth e Profile com o mesmo e-mail
        
        uid = data.profile_id
        
        # Se não temos UID ou queremos garantir que o e-mail no Auth está OK
        try:
            # Cria novo no auth. Se der erro de duplicidade, o catch pega.
            auth_res = db.auth.admin.create_user({
                "email": data.email,
                "password": data.password,
                "email_confirm": True
            })
            uid = auth_res.user.id
        except Exception as auth_err:
            # Provavelmente já existe no Auth. Vamos tentar atualizar a senha.
            # Nota: No Supabase Admin Python, não é trivial resetar sem o UID.
            # Mas podemos buscar o usuário pelo email primeiro.
            users_list = db.auth.admin.list_users() # Cuidado: Paginado
            users_iter = users_list if isinstance(users_list, list) else getattr(users_list, 'users', [])
            target_user = next((u for u in users_iter if u.email == data.email), None)
            
            if target_user:
                uid = target_user.id
                db.auth.admin.update_user_by_id(uid, {"password": data.password})
            else:
                raise auth_err

        # Agora garantimos que o Profile aponta para este UID
        # Se o perfil antigo tinha outro ID (ex: uuid gerado manualmente no seed), deletamos o antigo e criamos novo
        if data.profile_id and data.profile_id != uid:
            db.table("profiles").delete().eq("id", data.profile_id).execute()

        db.table("profiles").upsert({
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role
        }).execute()

        if data.role == "gerente":
            db.table("gerentes").upsert({"profile_id": uid}, on_conflict="profile_id").execute()

        return {"success": True, "id": uid}
    except Exception as e:
        raise HTTPException(400, str(e))

# ═══ GESTÃO DE SENHAS ═══════════════════════════════════════════════════

class AdminResetPasswordSchema(BaseModel):
    new_password: str
    force_change: bool = True   # se True, marca must_change_password=true

@router.post("/usuarios/{profile_id}/reset-password")
def api_admin_reset_password(profile_id: str, data: AdminResetPasswordSchema,
                              user: dict = Depends(get_current_user),
                              db: Client = Depends(get_db)):
    """Master define uma nova senha para qualquer usuário (saída de funcionário, esqueci, etc)."""
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem resetar senhas de terceiros")
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")
    if not data.new_password or len(data.new_password) < 6:
        raise HTTPException(400, "Senha deve ter no mínimo 6 caracteres")

    try:
        # 1. Atualiza senha no Supabase Auth (Admin API)
        db.auth.admin.update_user_by_id(profile_id, {"password": data.new_password})

        # 2. Marca para troca obrigatória no proximo login (recomendado)
        db.table("profiles").update({
            "must_change_password": bool(data.force_change),
            "password_changed_at": __import__('datetime').datetime.utcnow().isoformat() if not data.force_change else None,
        }).eq("id", profile_id).execute()

        return {"success": True}
    except Exception as e:
        print(f"[reset-password] erro: {e}")
        raise HTTPException(400, str(e))


class ChangeOwnPasswordSchema(BaseModel):
    new_password: str

@router.post("/auth/change-password")
def api_change_own_password(data: ChangeOwnPasswordSchema,
                            user: dict = Depends(get_current_user),
                            db: Client = Depends(get_db)):
    """Usuario autenticado troca a propria senha. Limpa o flag must_change_password."""
    if not data.new_password or len(data.new_password) < 6:
        raise HTTPException(400, "Senha deve ter no mínimo 6 caracteres")
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        import datetime as _dt
        db.auth.admin.update_user_by_id(user["id"], {"password": data.new_password})
        db.table("profiles").update({
            "must_change_password": False,
            "password_changed_at": _dt.datetime.utcnow().isoformat(),
        }).eq("id", user["id"]).execute()
        return {"success": True}
    except Exception as e:
        print(f"[change-password] erro: {e}")
        raise HTTPException(400, str(e))


@router.delete("/usuarios/{profile_id}")
def api_deletar_usuario(profile_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Deleta um usuário do Auth e do Profile (cascade)"""
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem excluir usuários")
    
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada")

    try:
        # 1. Deletar no Auth (isso vai disparar o ON DELETE CASCADE no profile e gerente)
        db.auth.admin.delete_user(profile_id)
        
        # 2. Por segurança, garantir que o profile foi removido (caso o cascade falhe ou demore)
        db.table("profiles").delete().eq("id", profile_id).execute()

        return {"success": True}
    except Exception as e:
        print(f"Erro ao deletar usuário: {e}")
        raise HTTPException(400, str(e))


# ═══ GERENCIAMENTO DE CARTEIRAS ═══════════════════════════════════════

@router.get("/usuarios/{profile_id}/carteiras")
def api_get_carteiras_gerente(profile_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Retorna os condomínios vinculados a um gerente específico."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    
    # Busca o gerente_id a partir do profile_id
    gerente_res = db.table("gerentes").select("id").eq("profile_id", profile_id).execute()
    if not gerente_res.data:
        return {"condominios_vinculados": [], "condominios_disponiveis": []}
    
    gerente_id = gerente_res.data[0]["id"]
    
    # Condomínios vinculados ao gerente
    vinculados_res = db.table("condominios").select("id, name").eq("gerente_id", gerente_id).order("name").execute()
    
    # Todos condomínios sem gerente (disponíveis para vincular)
    disponiveis_res = db.table("condominios").select("id, name").is_("gerente_id", "null").order("name").execute()
    
    return {
        "gerente_id": gerente_id,
        "condominios_vinculados": vinculados_res.data or [],
        "condominios_disponiveis": disponiveis_res.data or []
    }


class VincularCondoSchema(BaseModel):
    gerente_id: str
    condominio_id: str

@router.post("/usuarios/vincular-condo")
def api_vincular_condo(data: VincularCondoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Vincula um condomínio a um gerente."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    try:
        db.table("condominios").update({"gerente_id": data.gerente_id}).eq("id", data.condominio_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


class DesvincularCondoSchema(BaseModel):
    condominio_id: str

@router.post("/usuarios/desvincular-condo")
def api_desvincular_condo(data: DesvincularCondoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Remove o vínculo de um condomínio com qualquer gerente."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    try:
        db.table("condominios").update({"gerente_id": None}).eq("id", data.condominio_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/usuarios/lista-completa")
def api_usuarios_completo(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Retorna todos os usuários com seus condomínios vinculados (para o painel master)."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    
    # Profiles com dados do gerente
    profiles = db.table("profiles").select("*").order("full_name").execute().data or []
    
    # Gerentes com seus condomínios
    gerentes_res = db.table("gerentes").select("id, profile_id, condominios(id, name)").execute().data or []
    gerentes_map = {g["profile_id"]: g for g in gerentes_res}
    
    result = []
    for p in profiles:
        g = gerentes_map.get(p["id"])
        result.append({
            **p,
            "gerente_id": g["id"] if g else None,                 # gerentes.id (carteira própria, se for gerente)
            "gerente_responsavel_id": p.get("gerente_id"),        # profile do gerente responsável (se for assistente)
            "condominios": g["condominios"] if g else []
        })
    
    return {"usuarios": result}


class NotificacaoEmailSchema(BaseModel):
    notificacao_email: Optional[str] = None

@router.post("/usuarios/{profile_id}/notificacao-email")
def api_set_notificacao_email(profile_id: str, data: NotificacaoEmailSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Define o e-mail para onde vão as notificações deste usuário (vazio = usa o e-mail de login)."""
    if user["role"] != "master":
        raise HTTPException(403, "Acesso negado")
    val = (data.notificacao_email or "").strip() or None
    db.table("profiles").update({"notificacao_email": val}).eq("id", profile_id).execute()
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════════
# CondoFlow — Novas rotas RBAC + Conferência
# ═══════════════════════════════════════════════════════════════════════

from datetime import datetime
import hashlib

MESES_PT = {
    1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
    7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez'
}

# ═══ RBAC helpers ═════════════════════════════════════════════════════

# NOTE: listas mantidas como aliases para compatibilidade — fonte da verdade em auth_constants.py
ROLES_APROVADORES = APPROVE_DOCUMENT  # inclui supervisor_gerentes
ROLES_EMISSORES = EMIT_DOCUMENT       # ['master', 'departamento']
ROLES_LANCA_COBRANCAS = EDIT_COBRANCAS_EXTRAS


def require_role(user: dict, roles: list):
    """Levanta 403 se o usuario nao tiver um dos roles permitidos."""
    if user.get('role') not in roles:
        raise HTTPException(403, f"Acesso negado. Requer role: {', '.join(roles)}")


# ═══ Endpoint: Dados de conferência (Planilha + Cobranças) ════════════

@router.get("/condominio/{condo_id}/conferencia")
def api_dados_conferencia(condo_id: str, request: Request, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    import traceback
    from datetime import datetime

    MESES_PT = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',
                7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'}

    def parse_valor(v) -> float:
        if v is None: return 0.0
        s = str(v).strip().replace('R$','').replace(' ','')
        if s in ('','PLANILHA','-','—'): return 0.0
        if ',' in s:
            s = s.replace('.','').replace(',','.')
        else:
            parts = s.split('.')
            if len(parts) > 2:
                s = ''.join(parts[:-1]) + '.' + parts[-1]
        try: return float(s)
        except: return 0.0

    year = datetime.now().year
    meses = [{'mes':m,'mes_nome':MESES_PT[m],'condominio':0.0,'fundo_reserva':0.0,'total':0.0} for m in range(1,13)]
    total_condo = total_fundo = total_geral = 0.0

    try:
        rateios = db.table("rateios_config").select("id,nome,ordem").eq("condominio_id", condo_id).order("ordem").execute().data or []
        if rateios:
            r_ids = [r["id"] for r in rateios]
            colunas = [r["nome"] for r in rateios]
            vals = db.table("rateios_valores").select("rateio_id,month,valor").in_("rateio_id", r_ids).eq("ano", year).execute().data or []
            
            if not vals:
                last = db.table("rateios_valores").select("ano").in_("rateio_id", r_ids).order("ano", desc=True).limit(1).execute().data
                if last:
                    year = last[0]["ano"]
                    vals = db.table("rateios_valores").select("rateio_id,month,valor").in_("rateio_id", r_ids).eq("ano", year).execute().data or []
            
            for i, m_item in enumerate(meses):
                m = m_item['mes']
                mv = [v for v in vals if int(v["month"]) == m]
                
                # Valores por coluna
                vals_col = {}
                total_mes = 0.0
                for r in rateios:
                    v_str = next((v["valor"] for v in mv if v["rateio_id"] == r["id"]), "0.00")
                    v_float = parse_valor(v_str)
                    vals_col[r["nome"]] = v_float
                    total_mes += v_float
                
                meses[i].update({'valores': vals_col, 'total': total_mes})
                total_geral += total_mes
        else:
            colunas = ["Condomínio", "Fundo Reserva"]
    except Exception as e:
        print(f"[CONFERENCIA] Erro rateios: {e}"); traceback.print_exc()

    cobrancas = []
    try:
        # Filtra por mes/ano do pacote sendo conferido (frontend envia via query string)
        req_mes  = request.query_params.get("mes")
        req_ano  = request.query_params.get("ano")
        is_retif = request.query_params.get("retificacao") == "true"

        query = db.table("cobrancas_extras") \
            .select("id,description,amount,created_at,attachments,status,mes,ano,unidades") \
            .eq("condominio_id", condo_id) \
            .neq("status", "cancelada")

        if req_mes and req_ano:
            query = query.eq("mes", int(req_mes)).eq("ano", int(req_ano))

        extras = query.order("created_at", desc=True).execute().data or []

        for c in extras:
            # Conferência normal: só 'ativa'. Retificação: inclui 'processada' também.
            if not is_retif and c.get("status") == "processada":
                continue

            atts = c.get('attachments') or []
            signed_atts = []
            for a in atts:
                try:
                    res = db.storage.from_("emissoes").create_signed_url(a, 3600)
                    signed_atts.append(res.get('signedURL', a) if isinstance(res, dict) else a)
                except Exception:
                    signed_atts.append(a)

            mes_int = c.get('mes')
            cobrancas.append({
                'id':          c.get('id'),
                'descricao':   c.get('description') or 'Cobrança Extra',
                'mes':         mes_int,
                'mes_nome':    MESES_PT.get(mes_int, '—'),
                'ano':         c.get('ano'),
                'valor':       parse_valor(c.get('amount')),
                'unidades':    c.get('unidades'),
                'attachments': signed_atts,
            })
    except Exception as e:
        # Loga o erro real em vez de engolir silenciosamente
        print(f"[CONFERENCIA] Erro cobrancas_extras: {e}"); traceback.print_exc()

    return {
        'planilha': {
            'ano': year,
            'colunas': colunas,
            'meses': meses,
            'totais': {'total': round(total_geral, 2)}
        },
        'cobrancas_extras': cobrancas,
    }
class ApprovalActionV2(BaseModel):
    action: str              # 'approve' | 'reject'
    comment: Optional[str] = ""
    sign: Optional[bool] = False  # se True, registra assinatura digital

@router.post("/processo/{processo_id}/acao")
def api_processo_acao_v2(
    processo_id: str,
    data: ApprovalActionV2,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """
    Aprova ou solicita correção de um processo.

    - Solicitar correção: volta o processo para o EMISSOR original (emitido_por)
      com status 'Solicitar alteração' e registra o comentário.
    - Aprovar + sign=True: registra assinatura digital (nome, role, timestamp, hash).
    """
    require_role(user, ROLES_APROVADORES)

    try:
        proc_res = db.table("processos").select("*").eq("id", processo_id).single().execute()
        if not proc_res.data:
            raise HTTPException(404, "Processo não encontrado")

        proc = proc_res.data
        current_status = proc.get("status")
        emitido_por = proc.get("emitido_por")

        update_payload = {}
        historico_action = ""

        if data.action == 'approve':
            # Busca o fluxo diretamente no processo
            fluxo = int(proc.get("fluxo", 1))

            # Lógica de Próximo Status baseada no Fluxo
            if fluxo == 1:
                # Nível 1: Direto para Supervisora Contabilidade -> Aprovado
                update_payload['status'] = 'aprovado'

            elif fluxo == 2 or fluxo == 3:
                # Nível 2 e 3: Gerente -> Supervisora Contabilidade -> Aprovado
                if current_status == 'Aguardando Gerente' or current_status == 'pendente':
                    update_payload['status'] = 'Aguardando Supervisor'
                else:
                    update_payload['status'] = 'aprovado'

            elif fluxo == 4:
                # Nível 4: Gerente -> Sup. Gerentes -> Sp. Contabilidade -> Aprovado
                if current_status == 'Aguardando Gerente' or current_status == 'pendente':
                    update_payload['status'] = 'Aguardando Chefe'
                elif current_status == 'Aguardando Chefe':
                    update_payload['status'] = 'Aguardando Supervisor'
                else:
                    update_payload['status'] = 'aprovado'
            else:
                update_payload['status'] = 'aprovado'

            historico_action = 'Aprovado'

            # Assinatura digital
            if data.sign:
                try:
                    import hashlib
                    content_hash = hashlib.sha256(
                        f"{processo_id}:{user['id']}:{datetime.utcnow().isoformat()}".encode()
                    ).hexdigest()
                    db.table("assinaturas").insert({
                        "processo_id": processo_id,
                        "signer_id": user['id'],
                        "signer_name": user.get('full_name') or user.get('email', 'Usuário'),
                        "signer_role": user.get('role'),
                        "signature_hash": content_hash,
                        "metadata": {"action": "approve", "step": current_status}
                    }).execute()
                except Exception as sign_err:
                    print(f"Erro ao assinar: {sign_err}")

        elif data.action == 'reject':
            if not data.comment or not data.comment.strip():
                raise HTTPException(400, "Motivo da correção é obrigatório")
            update_payload['status'] = 'Solicitar alteração'
            update_payload['issue_notes'] = data.comment.strip()
            historico_action = 'Solicitado alteração'
        else:
            raise HTTPException(400, f"Ação desconhecida: {data.action}")

        # Atualiza processo
        db.table("processos").update(update_payload).eq("id", processo_id).execute()

        # Registra no histórico
        db.table("aprovacoes").insert({
            "processo_id": processo_id,
            "approver_id": user['id'],
            "action": historico_action,
            "comment": data.comment or ""
        }).execute()

        return {
            "success": True,
            "next_status": update_payload.get('status'),
            "returned_to": emitido_por if data.action == 'reject' else None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Endpoint: Documentos pendentes do usuário (para dashboard) ═══════

@router.get("/pendentes")
def api_pendentes(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Retorna documentos pendentes de ação do usuário atual.

    - Aprovadores: veem processos aguardando sua fila (Enviado, Em aprovação)
    - Emissores/Gerentes/Assistentes: veem os que voltaram para correção deles
    """
    role = user.get('role')
    try:
        query = db.table("processos").select(
            "id, status, issue_notes, condominio_id, emitido_por, condominios(name)"
        )

        if role in ROLES_APROVADORES or role == 'supervisor_gerentes':
            # Determinar qual status este usuário aprova
            status_target = []
            if role == 'master':
                # Master vê tudo que está aguardando
                pass
            elif role == 'gerente':
                status_target = ['Aguardando Gerente']
            elif role == 'supervisora':
                status_target = ['Aguardando Supervisora']
            elif role == 'supervisora_contabilidade':
                status_target = ['Aguardando Sp. Contabilidade']
            elif role == 'supervisor_gerentes':
                status_target = ['Aguardando Sup. Gerentes']
                
            if status_target:
                query = query.in_("status", status_target)
            else:
                query = query.like("status", "Aguardando%")

            # Gerente vê só dos condomínios dele
            if role == 'gerente':
                g_id = get_gerente_id(db, user['id'])
                if g_id:
                    condos_res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
                    condo_ids = [c['id'] for c in (condos_res.data or [])]
                    if condo_ids:
                        query = query.in_("condominio_id", condo_ids)
                    else:
                        return {"pendentes": []}
        elif role in ['emissor', 'assistente', 'departamento']:
            # Emissor/assistente vê os que voltaram pra correção (emitidos por ele ou com status Solicitar alteração)
            query = query.eq("status", "Solicitar alteração")
        else:
            return {"pendentes": []}

        res = query.execute()
        items = []
        for p in (res.data or []):
            items.append({
                'id': p['id'],
                'status': p.get('status'),
                'issue_notes': p.get('issue_notes'),
                'condominio_id': p.get('condominio_id'),
                'condominio_nome': (p.get('condominios') or {}).get('name', 'Condomínio'),
                'emitido_por': p.get('emitido_por'),
            })

        return {"pendentes": items}
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Endpoint: Assinaturas de um processo ═════════════════════════════

@router.get("/processo/{processo_id}/assinaturas")
def api_assinaturas(processo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Lista assinaturas digitais de um processo."""
    try:
        res = db.table("assinaturas") \
            .select("id, signer_name, signer_role, signed_at, signature_hash") \
            .eq("processo_id", processo_id) \
            .order("signed_at") \
            .execute()
        return {"assinaturas": res.data or []}
    except Exception as e:
        raise HTTPException(400, str(e))


# ═══ Vínculo gerente -> assistente ════════════════════════════════════

class VincularAssistenteSchema(BaseModel):
    gerente_id: str
    assistente_profile_id: Optional[str] = None  # None = remove vínculo


@router.post("/gerentes/vincular-assistente")
def api_vincular_assistente(
    data: VincularAssistenteSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Vincula um assistente a um gerente (apenas master)."""
    require_role(user, ['master'])
    try:
        db.table("gerentes").update({
            "assistente_id": data.assistente_profile_id
        }).eq("id", data.gerente_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))# ═══════════════════════════════════════════════════════════════
# Cole no FINAL do arquivo api/api_routes.py
# ═══════════════════════════════════════════════════════════════

from datetime import datetime as _dt

ROLES_LANCA_COBRANCA  = ['master', 'gerente', 'assistente']
ROLES_SOLICITA_CANCEL = ['master', 'gerente']
ROLES_EXECUTA_CANCEL  = ['master', 'departamento']

def _mes_atual():
    n = _dt.now()
    return n.month, n.year

class CobrancaExtraSchema(BaseModel):
    condominio_id: str
    descricao: str
    valor_total: float
    mes_inicio: int
    ano_inicio: int
    parcelas: int = 1   # 1 = sem parcelamento
    attachments: Optional[list] = []
    unidades: Optional[str] = None   # unidade(s) do condomínio (obrigatório)

@router.post("/cobrancas-extras/lancar")
def api_lancar_cobranca_extra(
    data: CobrancaExtraSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lança cobrança extra (simples ou parcelada). Não permite retroativo."""
    require_role(user, ROLES_LANCA_COBRANCA)

    mes_atual, ano_atual = _mes_atual()

    # Valida que não é retroativo
    if (data.ano_inicio < ano_atual) or \
       (data.ano_inicio == ano_atual and data.mes_inicio < mes_atual):
        raise HTTPException(400, "Não é permitido lançar cobranças retroativas.")

    if data.parcelas < 1 or data.parcelas > 24:
        raise HTTPException(400, "Número de parcelas deve ser entre 1 e 24.")

    if data.valor_total <= 0:
        raise HTTPException(400, "Valor deve ser maior que zero.")

    if not (data.unidades and data.unidades.strip()):
        raise HTTPException(400, "Informe a(s) unidade(s) do condomínio.")

    import uuid
    grupo_id = str(uuid.uuid4())
    valor_parcela = round(data.valor_total / data.parcelas, 2)

    try:
        registros = []
        for i in range(data.parcelas):
            # Calcula mês/ano de cada parcela
            mes = data.mes_inicio + i
            ano = data.ano_inicio
            while mes > 12:
                mes -= 12
                ano += 1

            desc = data.descricao
            if data.parcelas > 1:
                desc = f"{data.descricao} ({i+1}/{data.parcelas})"

            registros.append({
                "condominio_id": data.condominio_id,
                "description": desc,
                "amount": valor_parcela,
                "mes": mes,
                "ano": ano,
                "parcela_atual": i + 1,
                "parcela_total": data.parcelas,
                "grupo_id": grupo_id,
                "status": "ativa",
                "attachments": data.attachments,
                "unidades": data.unidades.strip(),
            })

        db.table("cobrancas_extras").insert(registros).execute()
        return {"success": True, "grupo_id": grupo_id, "parcelas_criadas": len(registros)}
    except Exception as e:
        raise HTTPException(400, str(e))



class SolicitarCancelamentoSchema(BaseModel):
    grupo_id: str
    motivo: str

@router.post("/cobrancas-extras/solicitar-cancelamento")
def api_solicitar_cancelamento(
    data: SolicitarCancelamentoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Gerente solicita cancelamento das parcelas futuras de uma cobrança."""
    require_role(user, ROLES_SOLICITA_CANCEL)

    mes_atual, ano_atual = _mes_atual()

    try:
        # Marca parcelas futuras como 'solicitado_cancelamento'
        parcelas = db.table("cobrancas_extras").select("id, mes, ano") \
            .eq("grupo_id", data.grupo_id).eq("status", "ativa").execute().data or []

        ids_futuros = []
        for p in parcelas:
            p_mes, p_ano = p["mes"], p["ano"]
            if (p_ano > ano_atual) or (p_ano == ano_atual and p_mes >= mes_atual):
                ids_futuros.append(p["id"])

        if not ids_futuros:
            raise HTTPException(400, "Não há parcelas futuras para cancelar.")

        db.table("cobrancas_extras").update({
            "status": "solicitado_cancelamento",
            "motivo_cancelamento": data.motivo,
            "solicitado_por": user["id"]
        }).in_("id", ids_futuros).execute()

        return {"success": True, "parcelas_solicitadas": len(ids_futuros)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class ExecutarCancelamentoSchema(BaseModel):
    grupo_id: str

@router.post("/cobrancas-extras/executar-cancelamento")
def api_executar_cancelamento(
    data: ExecutarCancelamentoSchema,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Emissor ou Master executa o cancelamento das parcelas solicitadas."""
    require_role(user, ROLES_EXECUTA_CANCEL)

    try:
        db.table("cobrancas_extras").update({
            "status": "cancelada",
            "cancelado_por": user["id"]
        }).eq("grupo_id", data.grupo_id).eq("status", "solicitado_cancelamento").execute()

        return {"success": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/cobrancas-extras/cancelamentos-pendentes")
def api_cancelamentos_pendentes(
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lista cobranças com cancelamento solicitado — visível para Emissor e Master."""
    require_role(user, ROLES_EXECUTA_CANCEL)

    try:
        res = db.table("cobrancas_extras") \
            .select("grupo_id, description, mes, ano, amount, motivo_cancelamento, condominio_id, condominios(name)") \
            .eq("status", "solicitado_cancelamento") \
            .order("created_at") \
            .execute()

        # Agrupa por grupo_id para mostrar apenas um card por lançamento
        grupos = {}
        for r in (res.data or []):
            gid = r["grupo_id"]
            if gid not in grupos:
                grupos[gid] = {
                    "grupo_id": gid,
                    "descricao": r["description"].split(" (")[0],  # remove "(1/3)"
                    "condominio": (r.get("condominios") or {}).get("name", ""),
                    "condominio_id": r["condominio_id"],
                    "motivo": r["motivo_cancelamento"],
                    "parcelas_pendentes": 0,
                    "valor_parcela": r["amount"],
                    "mes_inicio": r["mes"],
                    "ano_inicio": r["ano"],
                }
            grupos[gid]["parcelas_pendentes"] += 1

        return {"pendentes": list(grupos.values())}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/cobrancas-extras/{condominio_id}")
def api_listar_cobrancas(
    condominio_id: str,
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    """Lista cobranças extras de um condomínio, opcionalmente filtradas por mês/ano."""
    try:
        query = db.table("cobrancas_extras").select("*") \
            .eq("condominio_id", condominio_id) \
            .neq("status", "cancelada")
            
        if mes and ano:
            query = query.eq("mes", mes).eq("ano", ano)
            # Ao filtrar por mês, mostramos ativas e processadas (para conferência/histórico)
        
        # Note: Não filtramos por status 'ativa' aqui por padrão para que o painel de 
        # gerenciamento continue mostrando o histórico (ex: parcelas já processadas).
        # A limpeza visual "para as próximas" acontece no endpoint api_dados_conferencia.
            
        query = query.order("ano").order("mes")

        res = query.execute()
        
        cobrancas = res.data or []
        for c in cobrancas:
            if c.get("attachments"):
                signed_atts = []
                for a in c["attachments"]:
                    try:
                        res_url = db.storage.from_("emissoes").create_signed_url(a, 3600)
                        signed_atts.append(res_url.get('signedURL', a) if isinstance(res_url, dict) else a)
                    except:
                        signed_atts.append(a)
                c["attachments"] = signed_atts

        return {"cobrancas": cobrancas}
    except Exception as e:
        raise HTTPException(400, str(e))


# ============================================================
# EXTRACAO DE DADOS DE FATURA (Concessionaria) via Claude Vision
# ============================================================

@router.post("/emissoes/arquivos/{arquivo_id}/extrair-fatura")
def api_extrair_fatura(arquivo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Le um PDF de concessionaria (SABESP/COMGAS/ENEL) com Claude Haiku Vision
    e extrai: nome_condominio, vencimento, valor.
    """
    import base64
    import json as _json
    import re as _re
    from datetime import datetime

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY nao configurada no servidor.")

    # 1. Busca o registro do arquivo
    arq_res = db.table("emissoes_arquivos").select("*").eq("id", arquivo_id).limit(1).execute()
    if not arq_res.data:
        raise HTTPException(404, "Arquivo nao encontrado")
    arq = arq_res.data[0]

    if arq.get("categoria") != "concessionaria":
        raise HTTPException(400, "Extracao disponivel apenas para categoria 'concessionaria'")

    storage_path = arq.get("arquivo_url")
    if not storage_path:
        raise HTTPException(400, "Caminho do arquivo nao encontrado")

    # 2. Download do PDF do Supabase Storage
    try:
        pdf_bytes = db.storage.from_("emissoes").download(storage_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao baixar PDF: {e}")

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
    subtipo = (arq.get("subtipo") or "concessionaria").upper()

    # 3. Chamada ao Claude com PDF anexado
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)

        prompt = f"""Voce esta lendo uma fatura de concessionaria brasileira ({subtipo}).

Extraia EXATAMENTE 3 informacoes e retorne SOMENTE um JSON valido neste formato (sem markdown, sem explicacoes):

{{
  "nome_condominio": "Nome do condominio/cliente conforme aparece na conta",
  "vencimento": "YYYY-MM-DD",
  "valor": 0.00
}}

Regras:
- nome_condominio: pegue o campo "Cliente", "Razao Social" ou o nome do edificio/condominio impresso no topo. NUNCA pegue o nome da concessionaria (SABESP/COMGAS/ENEL).
- vencimento: data de vencimento da fatura (NAO confunda com data de emissao ou proxima leitura). Formato ISO YYYY-MM-DD.
- valor: valor TOTAL a pagar em reais (decimal com ponto). Se houver "Total" e "Subtotal", use o TOTAL final.
- Se nao conseguir extrair algum campo com certeza, use null.

Retorne APENAS o JSON, nada mais."""

        message = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )

        raw = message.content[0].text.strip()
        # Remove possivel cerca de markdown
        raw = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=_re.MULTILINE).strip()
        parsed = _json.loads(raw)

    except Exception as e:
        raise HTTPException(500, f"Falha na extracao por IA: {e}")

    # 4. Sanitiza valores
    nome = (parsed.get("nome_condominio") or "").strip() or None
    venc = parsed.get("vencimento")
    if venc:
        try:
            datetime.strptime(venc, "%Y-%m-%d")
        except Exception:
            venc = None
    valor = parsed.get("valor")
    try:
        valor = float(valor) if valor is not None else None
    except Exception:
        valor = None

    # 5. Persiste
    update_payload = {
        "nome_condominio_fatura": nome,
        "vencimento_fatura": venc,
        "valor_fatura": valor,
        "dados_extraidos_em": datetime.utcnow().isoformat(),
    }
    db.table("emissoes_arquivos").update(update_payload).eq("id", arquivo_id).execute()

    return {"ok": True, **update_payload}


class FaturaManualUpdate(BaseModel):
    nome_condominio_fatura: Optional[str] = None
    vencimento_fatura: Optional[str] = None  # YYYY-MM-DD
    valor_fatura: Optional[float] = None


@router.patch("/emissoes/arquivos/{arquivo_id}/fatura")
def api_atualizar_fatura(arquivo_id: str, data: FaturaManualUpdate, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Permite correcao manual dos campos extraidos pela IA."""
    from datetime import datetime
    payload = data.dict(exclude_unset=True)
    if "vencimento_fatura" in payload and payload["vencimento_fatura"]:
        try:
            datetime.strptime(payload["vencimento_fatura"], "%Y-%m-%d")
        except Exception:
            raise HTTPException(400, "vencimento_fatura deve estar em YYYY-MM-DD")
    payload["dados_extraidos_em"] = datetime.utcnow().isoformat()
    db.table("emissoes_arquivos").update(payload).eq("id", arquivo_id).execute()
    return {"ok": True}


# ============================================================
# EDICOES MENSAIS - ciclo de revisao e liberacao por gerente
# ============================================================

def _mes_alvo_padrao():
    """Mes/ano alvo padrao = M+1 (em junho abrimos julho)."""
    from datetime import datetime
    now = datetime.now()
    if now.month == 12:
        return 1, now.year + 1
    return now.month + 1, now.year


class AbrirEdicaoSchema(BaseModel):
    mes: Optional[int] = None
    ano: Optional[int] = None
    gerente_id: Optional[str] = None  # se nulo, abre pra todos


@router.post("/edicoes-mensais/abrir")
def api_abrir_edicao(data: AbrirEdicaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user.get("role") != "master":
        raise HTTPException(403, "Apenas master pode abrir edicao mensal")
    mes_padrao, ano_padrao = _mes_alvo_padrao()
    mes = data.mes or mes_padrao
    ano = data.ano or ano_padrao
    if mes < 1 or mes > 12:
        raise HTTPException(400, "mes invalido")

    cond_q = db.table("condominios").select("id, gerente_id")
    if data.gerente_id:
        cond_q = cond_q.eq("gerente_id", data.gerente_id)
    cond_res = cond_q.execute()
    condos = cond_res.data or []

    criados = 0
    reabertos = 0
    for c in condos:
        existing = db.table("edicoes_mensais").select("id, status") \
            .eq("condominio_id", c["id"]).eq("ano_referencia", ano).eq("mes_referencia", mes) \
            .limit(1).execute()
        if existing.data:
            row = existing.data[0]
            # Se ja existe e nao esta em_edicao, reabre
            if row["status"] != "em_edicao":
                db.table("edicoes_mensais").update({
                    "status": "em_edicao",
                    "aberto_por": user["id"],
                    "aberto_em": "now()",
                    "liberado_em": None,
                    "reabertura_solicitada_em": None,
                    "reabertura_motivo": None,
                    "reabertura_respondida_em": None,
                    "reabertura_respondida_por": None,
                    "reabertura_aprovada": None,
                }).eq("id", row["id"]).execute()
                reabertos += 1
        else:
            db.table("edicoes_mensais").insert({
                "condominio_id": c["id"],
                "gerente_id": c.get("gerente_id"),
                "mes_referencia": mes,
                "ano_referencia": ano,
                "status": "em_edicao",
                "aberto_por": user["id"],
            }).execute()
            criados += 1

    return {"ok": True, "mes": mes, "ano": ano, "criados": criados, "reabertos": reabertos, "total_condos": len(condos)}


@router.get("/edicoes-mensais")
def api_listar_edicoes(
    status: Optional[str] = None,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Lista edicoes. Gerente ve so as suas. Master/emissor/supervisor veem tudo."""
    q = db.table("edicoes_mensais").select("*, condominios(name)")
    if status:
        q = q.eq("status", status)
    if ano:
        q = q.eq("ano_referencia", ano)
    if mes:
        q = q.eq("mes_referencia", mes)

    role = user.get("role")
    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if not g_id:
            return {"edicoes": []}
        q = q.eq("gerente_id", g_id)

    q = q.order("ano_referencia", desc=True).order("mes_referencia", desc=True).order("aberto_em", desc=True)
    res = q.execute()
    return {"edicoes": res.data or []}


@router.post("/edicoes-mensais/{edicao_id}/liberar")
def api_liberar_edicao(edicao_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Gerente finaliza a edicao de UM condominio."""
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if edi.get("gerente_id") != g_id:
            raise HTTPException(403, "Voce nao gerencia este condominio")

    if edi["status"] != "em_edicao":
        raise HTTPException(400, f"Status atual nao permite liberacao: {edi['status']}")

    from datetime import datetime, timezone
    db.table("edicoes_mensais").update({
        "status": "edicao_finalizada",
        "liberado_em": datetime.now(timezone.utc).isoformat(),
    }).eq("id", edicao_id).execute()
    return {"ok": True}


class LiberarTodosSchema(BaseModel):
    mes: Optional[int] = None
    ano: Optional[int] = None


@router.post("/edicoes-mensais/liberar-todos")
def api_liberar_todos(data: LiberarTodosSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Gerente libera todos os seus condos do periodo de uma vez."""
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")

    from datetime import datetime, timezone
    mes_padrao, ano_padrao = _mes_alvo_padrao()
    mes = data.mes or mes_padrao
    ano = data.ano or ano_padrao

    q = db.table("edicoes_mensais").select("id") \
        .eq("status", "em_edicao") \
        .eq("ano_referencia", ano) \
        .eq("mes_referencia", mes)

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if not g_id:
            return {"ok": True, "liberados": 0}
        q = q.eq("gerente_id", g_id)

    res = q.execute()
    ids = [e["id"] for e in (res.data or [])]
    if not ids:
        return {"ok": True, "liberados": 0}

    db.table("edicoes_mensais").update({
        "status": "edicao_finalizada",
        "liberado_em": datetime.now(timezone.utc).isoformat(),
    }).in_("id", ids).execute()
    return {"ok": True, "liberados": len(ids)}


class SolicitarReaberturaSchema(BaseModel):
    motivo: str


@router.post("/edicoes-mensais/{edicao_id}/solicitar-reabertura")
def api_solicitar_reabertura(edicao_id: str, data: SolicitarReaberturaSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "gerente"):
        raise HTTPException(403, "Sem permissao")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "Motivo e obrigatorio")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if role == "gerente":
        g_id = get_gerente_id(db, user["id"])
        if edi.get("gerente_id") != g_id:
            raise HTTPException(403, "Voce nao gerencia este condominio")

    if edi["status"] != "edicao_finalizada":
        raise HTTPException(400, "Reabertura so para edicoes finalizadas")

    from datetime import datetime, timezone
    db.table("edicoes_mensais").update({
        "status": "reabertura_solicitada",
        "reabertura_solicitada_em": datetime.now(timezone.utc).isoformat(),
        "reabertura_motivo": data.motivo.strip(),
    }).eq("id", edicao_id).execute()
    return {"ok": True}


class ResponderReaberturaSchema(BaseModel):
    aprovar: bool


@router.post("/edicoes-mensais/{edicao_id}/responder-reabertura")
def api_responder_reabertura(edicao_id: str, data: ResponderReaberturaSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor pode responder reaberturas")

    edi_res = db.table("edicoes_mensais").select("*").eq("id", edicao_id).limit(1).execute()
    if not edi_res.data:
        raise HTTPException(404, "Edicao nao encontrada")
    edi = edi_res.data[0]

    if edi["status"] != "reabertura_solicitada":
        raise HTTPException(400, "Nao ha solicitacao pendente")

    from datetime import datetime, timezone
    new_status = "em_edicao" if data.aprovar else "edicao_finalizada"
    db.table("edicoes_mensais").update({
        "status": new_status,
        "reabertura_respondida_em": datetime.now(timezone.utc).isoformat(),
        "reabertura_respondida_por": user["id"],
        "reabertura_aprovada": data.aprovar,
    }).eq("id", edicao_id).execute()
    return {"ok": True, "novo_status": new_status}


# ============================================================
# CONSUMOS - faturas de concessionaria por mes/condo
# ============================================================

class ConsumoCreateSchema(BaseModel):
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    concessionaria: str
    leitura_atual: Optional[str] = None   # YYYY-MM-DD
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    arquivo_url: Optional[str] = None
    arquivo_nome: Optional[str] = None
    arquivo_hash: Optional[str] = None
    descricao: Optional[str] = None
    marcada_repetida: Optional[bool] = False


def _is_assistente_or_emissor_or_master(role: Optional[str]) -> bool:
    return role in ("master", "departamento", "assistente")


@router.get("/consumos")
def api_listar_consumos(
    condominio_id: Optional[str] = None,
    ano: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """Lista faturas. Todos os roles autenticados podem ler."""
    q = db.table("consumos_faturas").select("*, condominios(name)").order("ano_referencia", desc=True).order("mes_referencia", desc=True)
    # Gerente/assistente só enxergam faturas da sua carteira
    if user.get("role") in ("gerente", "assistente"):
        ids = carteira_condo_ids(db, user)
        if not ids:
            return {"consumos": []}
        q = q.in_("condominio_id", ids)
    if condominio_id:
        q = q.eq("condominio_id", condominio_id)
    if ano:
        q = q.eq("ano_referencia", ano)
    res = q.execute()
    return {"consumos": res.data or []}


@router.get("/consumos/condominios-com-faturas")
def api_consumos_condos(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Lista condos que tem fatura OU estao cadastrados em condominios_concessionarias."""
    import re as _re
    import traceback
    try:
        cfg_map = {}
        try:
            cfg_res = db.table("condominios_concessionarias").select("condominio_id, concessionaria").execute()
            for r in (cfg_res.data or []):
                cid = r["condominio_id"]
                cfg_map.setdefault(cid, set()).add(r["concessionaria"])
        except Exception as e:
            print(f"[consumos] cond_conc erro: {e}")

        try:
            fat_res = db.table("consumos_faturas").select("condominio_id, concessionaria").execute()
            for r in (fat_res.data or []):
                cid = r.get("condominio_id")
                if cid:
                    cfg_map.setdefault(cid, set()).add(r["concessionaria"])
        except Exception as e:
            print(f"[consumos] consumos_faturas erro: {e}")

        if not cfg_map:
            return {"condominios": []}

        ids = list(cfg_map.keys())
        # Chunking para evitar erro com listas grandes
        condos_data = []
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            res = db.table("condominios").select("id, name, due_day, due_day_2, gerente_id").in_("id", chunk).execute()
            condos_data.extend(res.data or [])

        gerente_ids = list({c.get("gerente_id") for c in condos_data if c.get("gerente_id")})
        gerentes_map = {}
        if gerente_ids:
            for i in range(0, len(gerente_ids), 100):
                chunk = gerente_ids[i:i+100]
                ger_res = db.table("gerentes").select("id, nome").in_("id", chunk).execute()
                for g in (ger_res.data or []):
                    gerentes_map[g["id"]] = g.get("nome")

        out = []
        for c in condos_data:
            nome = c.get("name") or ""
            m = _re.match(r"^(\d+)", nome.strip())
            codigo = int(m.group(1)) if m else 999999
            out.append({
                "id": c["id"],
                "name": nome,
                "codigo": codigo,
                "due_day": c.get("due_day"),
                "due_day_2": c.get("due_day_2"),
                "gerente_id": c.get("gerente_id"),
                "gerente_nome": gerentes_map.get(c.get("gerente_id")),
                "concessionarias": sorted(list(cfg_map.get(c["id"], set()))),
            })
        # Gerente/assistente só enxergam a carteira (própria ou do gerente vinculado)
        if user.get("role") in ("gerente", "assistente"):
            allowed = set(carteira_condo_ids(db, user))
            out = [c for c in out if c["id"] in allowed]
        out.sort(key=lambda x: (x["codigo"], x["name"]))
        return {"condominios": out}
    except Exception as e:
        tb = traceback.format_exc()
        print("[consumos] erro fatal:", tb)
        # Expor o erro para debug remoto
        raise HTTPException(500, f"{type(e).__name__}: {str(e)}")


@router.get("/consumos/check-duplicata")
def api_consumos_check_duplicata(arquivo_hash: str, condominio_id: Optional[str] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Procura faturas existentes com o mesmo hash."""
    q = db.table("consumos_faturas").select("id, condominio_id, condominios(name), mes_referencia, ano_referencia, concessionaria").eq("arquivo_hash", arquivo_hash)
    if condominio_id:
        q = q.eq("condominio_id", condominio_id)
    res = q.execute()
    return {"duplicatas": res.data or []}


class CheckDuplicataCompletaFatura(BaseModel):
    tipo: str = "fatura"  # 'fatura' ou 'relatorio'
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    # Para fatura
    concessionaria: Optional[str] = None
    leitura_atual: Optional[str] = None        # YYYY-MM-DD
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    # Para relatorio
    empresa: Optional[str] = None
    tipo_servico: Optional[str] = None
    consumo_total: Optional[float] = None
    numero_unidades: Optional[int] = None
    valor_total: Optional[float] = None
    # Hash do PDF (opcional, pode ser checado separado tambem)
    arquivo_hash: Optional[str] = None


# ========== Validação de pertencimento (a conta é deste condomínio?) ==========
import re
import unicodedata as _unicodedata

# Palavras genéricas que não identificam o condomínio (removidas na comparação)
_PALAVRAS_GENERICAS = {
    "CONDOMINIO", "CONDOMINIOS", "COND", "CD",
    "EDIFICIO", "EDIF", "ED", "EDIFICIOS",
    "RESIDENCIAL", "RESID", "RES",
    "COMERCIAL", "EMPRESARIAL",
    "PREDIO", "BLOCO", "TORRE", "TORRES", "CONJUNTO", "CONJ", "CJ",
    "AUTONOMO", "AUTONOMA", "ASSOCIACAO", "ASSOC",
    "DO", "DA", "DE", "DOS", "DAS", "E",
}


def _tokens_significativos(nome: Optional[str]) -> set:
    """Normaliza um nome (sem acento, maiúsculo, sem código numérico/genéricos) -> set de tokens."""
    if not nome:
        return set()
    s = _unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode("ascii").upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    toks = set()
    for t in s.split():
        if not t or t.isdigit():           # ignora códigos numéricos ("002")
            continue
        if t in _PALAVRAS_GENERICAS:
            continue
        if len(t) < 3:                      # ignora siglas curtas/ruído
            continue
        toks.add(t)
    return toks


def _score_pertencimento(cliente: Optional[str], condo_nome: Optional[str]) -> float:
    """0.0 a 1.0 — quão bem o nome do cliente (na conta) casa com o nome do condomínio."""
    a = _tokens_significativos(cliente)
    b = _tokens_significativos(condo_nome)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def checar_pertencimento(db: Client, condominio_id: str, cliente: Optional[str]) -> Optional[dict]:
    """
    Retorna um alerta de BLOQUEIO se a conta claramente NÃO pertence ao condomínio
    selecionado (o nome do cliente casa muito melhor com outro condomínio cadastrado).
    Retorna None quando passa (ou quando não há dados suficientes para decidir).
    """
    if not cliente or len(_tokens_significativos(cliente)) < 2:
        return None  # sem nome confiável na conta -> não dá pra validar

    try:
        sel = db.table("condominios").select("id, name").eq("id", condominio_id).maybeSingle().execute()
        condo_sel = sel.data or {}
    except Exception:
        return None
    nome_sel = condo_sel.get("name")
    score_sel = _score_pertencimento(cliente, nome_sel)
    if score_sel >= 0.34:
        return None  # casa com o condomínio selecionado -> ok

    # Não casou com o selecionado. Procura se casa com OUTRO condomínio.
    try:
        todos = db.table("condominios").select("id, name").execute().data or []
    except Exception:
        todos = []

    melhor = None
    melhor_score = 0.0
    for c in todos:
        if c.get("id") == condominio_id:
            continue
        sc = _score_pertencimento(cliente, c.get("name"))
        if sc > melhor_score:
            melhor_score = sc
            melhor = c

    # Só bloqueia quando há outro condomínio que casa claramente melhor.
    if melhor and melhor_score >= 0.5 and melhor_score > score_sel:
        return {
            "nivel": "bloqueio",
            "tipo": "pertencimento",
            "mensagem": (
                f"Esta conta é do cliente \"{cliente}\", que corresponde ao condomínio "
                f"\"{melhor.get('name')}\" — NÃO a \"{nome_sel or 'este condomínio'}\". "
                f"Retire esta conta: não é permitido anexar fatura de outro condomínio."
            ),
            "detalhes": {
                "cliente": cliente,
                "condominio_selecionado": nome_sel,
                "condominio_correto": melhor.get("name"),
            },
        }
    return None


@router.post("/consumos/check-duplicata-completa")
def api_check_duplicata_completa(data: CheckDuplicataCompletaFatura, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Verifica em 3 niveis:
      1. Hash identico (qualquer condo)
      2. (condo, mes, ano, conc OR empresa+tipo) ja existe
      3. Dados iguais ao mes anterior (leituras+valor pra fatura; consumo+valor+unidades pra relatorio)
    Retorna { bloqueia: bool, alertas: [...], anomalia: {...} }
    """
    alertas = []  # cada alerta: { nivel: 'bloqueio'|'aviso', tipo, mensagem, detalhes }

    # ===== 1) Hash duplicado =====
    if data.arquivo_hash:
        if data.tipo == "fatura":
            res = db.table("consumos_faturas").select(
                "id, condominio_id, condominios(name), mes_referencia, ano_referencia, concessionaria"
            ).eq("arquivo_hash", data.arquivo_hash).execute()
        else:
            res = db.table("consumos_relatorios_leitura").select(
                "id, condominio_id, condominios(name), mes_referencia, ano_referencia, empresa_leitura, tipo_servico"
            ).eq("arquivo_hash", data.arquivo_hash).execute()

        for hit in (res.data or []):
            alertas.append({
                "nivel": "bloqueio",
                "tipo": "hash_identico",
                "mensagem": "Este arquivo PDF identico ja foi anexado anteriormente.",
                "detalhes": hit,
            })

    # ===== 2) Mesma fatura/relatorio para o mesmo periodo (UNIQUE) =====
    if data.tipo == "fatura" and data.concessionaria:
        res = db.table("consumos_faturas").select(
            "id, valor, vencimento, leitura_atual, proxima_leitura, arquivo_url, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", data.ano_referencia) \
         .eq("mes_referencia", data.mes_referencia) \
         .eq("concessionaria", data.concessionaria.upper()) \
         .execute()
        if res.data:
            alertas.append({
                "nivel": "aviso",
                "tipo": "fatura_ja_existe",
                "mensagem": f"Ja existe {len(res.data)} fatura(s) de {data.concessionaria} em {data.mes_referencia:02d}/{data.ano_referencia}. Se for outra instalacao/conta, pode anexar normalmente.",
                "detalhes": res.data[0],
            })
    elif data.tipo == "relatorio" and data.empresa and data.tipo_servico:
        res = db.table("consumos_relatorios_leitura").select(
            "id, valor_total, consumo_total, numero_unidades, data_leitura, arquivo_url, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", data.ano_referencia) \
         .eq("mes_referencia", data.mes_referencia) \
         .eq("empresa_leitura", data.empresa.upper()) \
         .eq("tipo_servico", data.tipo_servico.lower()) \
         .execute()
        if res.data:
            alertas.append({
                "nivel": "aviso",
                "tipo": "relatorio_ja_existe",
                "mensagem": f"Ja existe {len(res.data)} relatorio(s) de {data.empresa} ({data.tipo_servico}) em {data.mes_referencia:02d}/{data.ano_referencia}. Se for outra leitura/conta, pode anexar normalmente.",
                "detalhes": res.data[0],
            })

    # ===== 3) Dados iguais ao mes anterior =====
    # Calcula mes anterior
    mes_ant = data.mes_referencia - 1
    ano_ant = data.ano_referencia
    if mes_ant == 0:
        mes_ant = 12
        ano_ant -= 1

    anomalia = None

    if data.tipo == "fatura" and data.concessionaria:
        res = db.table("consumos_faturas").select(
            "id, valor, vencimento, leitura_atual, proxima_leitura, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", ano_ant) \
         .eq("mes_referencia", mes_ant) \
         .eq("concessionaria", data.concessionaria.upper()) \
         .maybeSingle().execute()
        prev = res.data
        if prev:
            iguais = 0
            campos = []
            if data.leitura_atual and prev.get("leitura_atual") and str(data.leitura_atual) == str(prev["leitura_atual"]):
                iguais += 1; campos.append("leitura_atual")
            if data.proxima_leitura and prev.get("proxima_leitura") and str(data.proxima_leitura) == str(prev["proxima_leitura"]):
                iguais += 1; campos.append("proxima_leitura")
            if data.valor is not None and prev.get("valor") is not None and abs(float(data.valor) - float(prev["valor"])) < 0.01:
                iguais += 1; campos.append("valor")
            # Variacao percentual de valor
            variacao_pct = None
            try:
                if data.valor is not None and prev.get("valor"):
                    prev_v = float(prev["valor"])
                    if prev_v > 0:
                        variacao_pct = (float(data.valor) - prev_v) / prev_v * 100.0
            except Exception:
                pass
            anomalia = {
                "previous": prev,
                "campos_iguais": campos,
                "total_iguais": iguais,
                "variacao_pct": variacao_pct,
            }
            if iguais >= 3:
                alertas.append({
                    "nivel": "bloqueio",
                    "tipo": "dados_iguais_mes_anterior",
                    "mensagem": "Leitura atual, proxima leitura e valor sao identicos ao mes anterior. Provavelmente a mesma fatura foi anexada novamente.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })
            elif iguais == 2:
                alertas.append({
                    "nivel": "aviso",
                    "tipo": "dados_parcialmente_iguais",
                    "mensagem": f"2 dos 3 campos ({', '.join(campos)}) sao identicos ao mes anterior. Confira se nao e um reenvio.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })

    elif data.tipo == "relatorio" and data.empresa and data.tipo_servico:
        res = db.table("consumos_relatorios_leitura").select(
            "id, consumo_total, valor_total, numero_unidades, data_leitura, arquivo_nome"
        ).eq("condominio_id", data.condominio_id) \
         .eq("ano_referencia", ano_ant) \
         .eq("mes_referencia", mes_ant) \
         .eq("empresa_leitura", data.empresa.upper()) \
         .eq("tipo_servico", data.tipo_servico.lower()) \
         .maybeSingle().execute()
        prev = res.data
        if prev:
            iguais = 0
            campos = []
            if data.consumo_total is not None and prev.get("consumo_total") is not None and abs(float(data.consumo_total) - float(prev["consumo_total"])) < 0.01:
                iguais += 1; campos.append("consumo_total")
            if data.valor_total is not None and prev.get("valor_total") is not None and abs(float(data.valor_total) - float(prev["valor_total"])) < 0.01:
                iguais += 1; campos.append("valor_total")
            if data.numero_unidades is not None and prev.get("numero_unidades") is not None and int(data.numero_unidades) == int(prev["numero_unidades"]):
                iguais += 1; campos.append("numero_unidades")
            variacao_pct = None
            try:
                if data.valor_total is not None and prev.get("valor_total"):
                    prev_v = float(prev["valor_total"])
                    if prev_v > 0:
                        variacao_pct = (float(data.valor_total) - prev_v) / prev_v * 100.0
            except Exception:
                pass
            anomalia = {
                "previous": prev,
                "campos_iguais": campos,
                "total_iguais": iguais,
                "variacao_pct": variacao_pct,
            }
            if iguais >= 3 or (iguais >= 2 and "valor_total" in campos and "consumo_total" in campos):
                alertas.append({
                    "nivel": "bloqueio",
                    "tipo": "dados_iguais_mes_anterior",
                    "mensagem": "Consumo total e valor sao identicos ao mes anterior. Provavelmente o mesmo relatorio foi reenviado.",
                    "detalhes": prev,
                    "campos_iguais": campos,
                })
            elif iguais >= 1 and variacao_pct is not None and abs(variacao_pct) < 5:
                alertas.append({
                    "nivel": "aviso",
                    "tipo": "variacao_minima",
                    "mensagem": f"Valor com variacao < 5% em relacao ao mes anterior ({variacao_pct:.1f}%). Confira se nao e o mesmo relatorio.",
                    "detalhes": prev,
                })

    bloqueia = any(a["nivel"] == "bloqueio" for a in alertas)
    return {
        "bloqueia": bloqueia,
        "alertas": alertas,
        "anomalia": anomalia,
    }


class ConfirmarRepeticaoSchema(BaseModel):
    tipo: str  # 'fatura' ou 'relatorio'
    condominio_id: str
    mes_referencia: int
    ano_referencia: int
    motivo: str
    anexo_url: Optional[str] = None      # documento de aprovação da repetição (obrigatório)
    anexo_nome: Optional[str] = None
    # Identificação do registro recém-criado pelo trigger
    concessionaria: Optional[str] = None  # fatura
    empresa: Optional[str] = None         # relatorio
    tipo_servico: Optional[str] = None    # relatorio


@router.post("/consumos/sancionar-repeticao")
def api_sancionar_repeticao(data: ConfirmarRepeticaoSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Sanciona a repetição de uma conta. Exige MOTIVO e ANEXO de aprovação.
    O emissor (assistente/departamento/master) pode sancionar a própria repetição.
    """
    if not _is_assistente_or_emissor_or_master(user.get("role")):
        raise HTTPException(403, "Sem permissao para sancionar repeticao")
    if not data.motivo or not data.motivo.strip():
        raise HTTPException(400, "Motivo e obrigatorio")
    if not data.anexo_url:
        raise HTTPException(400, "Anexo de aprovacao da repeticao e obrigatorio")
    from datetime import datetime, timezone
    payload = {
        "marcada_repetida": True,
        "motivo_repeticao": data.motivo.strip(),
        "repeticao_anexo_url": data.anexo_url,
        "repeticao_anexo_nome": data.anexo_nome,
        "repeticao_confirmada_por": user["id"],
        "repeticao_confirmada_em": datetime.now(timezone.utc).isoformat(),
    }
    table = "consumos_faturas" if data.tipo == "fatura" else "consumos_relatorios_leitura"
    q = db.table(table).update(payload) \
        .eq("condominio_id", data.condominio_id) \
        .eq("ano_referencia", data.ano_referencia) \
        .eq("mes_referencia", data.mes_referencia)
    if data.tipo == "fatura":
        if data.concessionaria:
            q = q.eq("concessionaria", data.concessionaria.upper())
    else:
        if data.empresa:
            q = q.eq("empresa_leitura", data.empresa.upper())
        if data.tipo_servico:
            q = q.eq("tipo_servico", data.tipo_servico.lower())
    q.execute()
    return {"ok": True}


@router.post("/consumos/extrair-pdf")
async def api_extrair_pdf(
    file: UploadFile = File(...),
    condominio_id: Optional[str] = None,
    mes_referencia: Optional[int] = None,
    ano_referencia: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """
    Extrai dados de um PDF de fatura (SABESP/COMGAS/ENEL) ou relatorio (Prosper).
    Se condominio_id+mes+ano forem passados, tambem roda o check de duplicata.
    Retorna: { extracao: {...}, alertas: [...], anomalia: {...}, bloqueia: bool }
    """
    import hashlib
    from pdf_extractor import extract_pdf, cnpj_to_passwords

    contents = await file.read()
    arquivo_hash = hashlib.sha256(contents).hexdigest()

    # Senhas-candidatas para PDFs protegidos (derivadas do CNPJ do condominio)
    passwords = []
    if condominio_id:
        try:
            cres = db.table("condominios").select("cnpj").eq("id", condominio_id).maybeSingle().execute()
            passwords = cnpj_to_passwords((cres.data or {}).get("cnpj"))
        except Exception as e:
            print(f"[extrair-pdf] falha ao buscar cnpj do condo: {e}")

    extracao = extract_pdf(contents, passwords=passwords)
    extracao['arquivo_hash'] = arquivo_hash
    extracao['arquivo_nome'] = file.filename

    # Status derivado pra UI/persistencia
    conf = extracao.get('confianca') or 0.0
    if extracao.get('erro'):
        extracao['status'] = 'falha'
    elif conf >= 0.8:
        extracao['status'] = 'sucesso'
    else:
        extracao['status'] = 'parcial'

    alertas = []
    anomalia = None
    bloqueia = False

    # ===== Pertencimento: a conta é DESTE condomínio? (bloqueio duro, prioridade máxima) =====
    if condominio_id and not extracao.get('erro'):
        try:
            alerta_pert = checar_pertencimento(db, condominio_id, extracao.get('cliente'))
            if alerta_pert:
                alertas.append(alerta_pert)
                bloqueia = True
        except Exception as e:
            print(f"[extrair-pdf] check pertencimento falhou: {e}")

    # Se identificou a empresa e tem contexto, valida duplicata
    if extracao.get('subtipo') and condominio_id and mes_referencia and ano_referencia:
        check_body = CheckDuplicataCompletaFatura(
            tipo='relatorio' if extracao.get('tipo') == 'relatorio' else 'fatura',
            condominio_id=condominio_id,
            mes_referencia=mes_referencia,
            ano_referencia=ano_referencia,
            arquivo_hash=arquivo_hash,
        )
        if extracao.get('tipo') == 'fatura':
            check_body.concessionaria = extracao['subtipo'].upper()
            check_body.leitura_atual = extracao.get('leitura_atual')
            check_body.proxima_leitura = extracao.get('proxima_leitura')
            check_body.vencimento = extracao.get('vencimento')
            check_body.valor = extracao.get('valor')
        else:
            check_body.empresa = extracao['subtipo'].upper()
            check_body.tipo_servico = extracao.get('tipo_servico', 'agua')
            check_body.consumo_total = extracao.get('consumo_total')
            check_body.valor_total = extracao.get('valor_total')
            check_body.numero_unidades = extracao.get('numero_unidades')

        try:
            result = api_check_duplicata_completa(check_body, user, db)
            # Mantém o alerta de pertencimento já adicionado (não sobrescreve)
            alertas = alertas + (result.get('alertas') or [])
            anomalia = result.get('anomalia')
            bloqueia = bloqueia or result.get('bloqueia', False)
        except Exception as e:
            print(f"[extrair-pdf] check duplicata falhou: {e}")

    return {
        'extracao': extracao,
        'alertas': alertas,
        'anomalia': anomalia,
        'bloqueia': bloqueia,
    }


@router.post("/consumos")
def api_criar_consumo(data: ConsumoCreateSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Cria fatura. Assistente cria como 'pendente'. Master/Emissor podem criar ja 'anexada'."""
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao para criar faturas de consumo")

    payload = data.dict(exclude_unset=True)
    payload["enviada_por"] = user["id"]
    payload["status"] = "pendente"
    try:
        res = db.table("consumos_faturas").insert(payload).execute()
        if not res.data:
            raise HTTPException(500, "Falha ao criar fatura")
        return {"ok": True, "consumo": res.data[0]}
    except Exception as e:
        msg = str(e)
        if "uq_consumos_condo_periodo_conc" in msg or "duplicate key" in msg.lower():
            raise HTTPException(400, "Este arquivo identico ja foi anexado para esta concessionaria neste mes. (Contas de instalacoes diferentes sao permitidas — verifique se nao e o mesmo PDF.)")
        raise HTTPException(400, msg)


class ConsumoUpdateSchema(BaseModel):
    leitura_atual: Optional[str] = None
    proxima_leitura: Optional[str] = None
    vencimento: Optional[str] = None
    valor: Optional[float] = None
    arquivo_url: Optional[str] = None
    arquivo_nome: Optional[str] = None
    arquivo_hash: Optional[str] = None
    descricao: Optional[str] = None
    marcada_repetida: Optional[bool] = None
    concessionaria: Optional[str] = None


@router.patch("/consumos/{consumo_id}")
def api_atualizar_consumo(consumo_id: str, data: ConsumoUpdateSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao")
    payload = data.dict(exclude_unset=True)
    if not payload:
        return {"ok": True}
    db.table("consumos_faturas").update(payload).eq("id", consumo_id).execute()
    return {"ok": True}


@router.post("/consumos/{consumo_id}/anexar")
def api_anexar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Emissor/Master marca como 'anexada' (final)."""
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas emissor/master pode anexar")
    from datetime import datetime, timezone
    db.table("consumos_faturas").update({
        "status": "anexada",
        "anexada_por": user["id"],
        "anexada_em": datetime.now(timezone.utc).isoformat(),
    }).eq("id", consumo_id).execute()
    return {"ok": True}


@router.post("/consumos/{consumo_id}/duplicar")
def api_duplicar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """Duplica a fatura para o proximo mes: datas + 1 mes, valor/arquivo zerados."""
    role = user.get("role")
    if not _is_assistente_or_emissor_or_master(role):
        raise HTTPException(403, "Sem permissao")

    orig = db.table("consumos_faturas").select("*").eq("id", consumo_id).maybeSingle().execute()
    if not orig.data:
        raise HTTPException(404, "Fatura nao encontrada")
    o = orig.data

    from datetime import datetime, date
    def _add_month_iso(s):
        if not s:
            return None
        try:
            d = datetime.strptime(s, "%Y-%m-%d").date()
        except Exception:
            return None
        m = d.month + 1
        y = d.year
        if m > 12:
            m = 1
            y += 1
        try:
            return date(y, m, d.day).isoformat()
        except ValueError:
            # Caso o dia nao exista no proximo mes (ex: 31/01 -> 28/02)
            import calendar
            last = calendar.monthrange(y, m)[1]
            return date(y, m, min(d.day, last)).isoformat()

    next_mes = o["mes_referencia"] + 1
    next_ano = o["ano_referencia"]
    if next_mes > 12:
        next_mes = 1
        next_ano += 1

    new_row = {
        "condominio_id": o["condominio_id"],
        "mes_referencia": next_mes,
        "ano_referencia": next_ano,
        "concessionaria": o["concessionaria"],
        "leitura_atual": _add_month_iso(o.get("leitura_atual")),
        "proxima_leitura": _add_month_iso(o.get("proxima_leitura")),
        "vencimento": _add_month_iso(o.get("vencimento")),
        "valor": None,
        "arquivo_url": None,
        "arquivo_nome": None,
        "arquivo_hash": None,
        "descricao": None,
        "marcada_repetida": False,
        "status": "pendente",
        "enviada_por": user["id"],
        "origem_duplicacao": o["id"],
    }
    try:
        res = db.table("consumos_faturas").insert(new_row).execute()
        return {"ok": True, "consumo": (res.data or [None])[0]}
    except Exception as e:
        msg = str(e)
        if "uq_consumos_condo_periodo_conc" in msg or "duplicate key" in msg.lower():
            raise HTTPException(400, f"Ja existe fatura de {o['concessionaria']} em {next_mes:02d}/{next_ano}")
        raise HTTPException(400, msg)


@router.delete("/consumos/{consumo_id}")
def api_deletar_consumo(consumo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    role = user.get("role")
    if role not in ("master", "departamento"):
        raise HTTPException(403, "Apenas master/emissor pode deletar")

    arquivo_url = None
    origem_id = None
    tabela = None

    # Detecta se o id é de uma FATURA ou de um RELATÓRIO de leitura
    try:
        c = db.table("consumos_faturas").select(
            "arquivo_url, origem_emissao_arquivo_id"
        ).eq("id", consumo_id).maybeSingle().execute()
        if c.data:
            tabela = "consumos_faturas"
            arquivo_url = c.data.get("arquivo_url")
            origem_id = c.data.get("origem_emissao_arquivo_id")
    except Exception:
        pass

    if not tabela:
        try:
            r = db.table("consumos_relatorios_leitura").select(
                "arquivo_url, origem_emissao_arquivo_id"
            ).eq("id", consumo_id).maybeSingle().execute()
            if r.data:
                tabela = "consumos_relatorios_leitura"
                arquivo_url = r.data.get("arquivo_url")
                origem_id = r.data.get("origem_emissao_arquivo_id")
        except Exception:
            pass

    if not tabela:
        raise HTTPException(404, "Consumo não encontrado (fatura ou relatório)")

    # 1) Remove a fatura/relatório
    db.table(tabela).delete().eq("id", consumo_id).execute()

    # 2) Remove o anexo de origem na Central (o trigger AFTER DELETE limpa o resto)
    if origem_id:
        try:
            db.table("emissoes_arquivos").delete().eq("id", origem_id).execute()
        except Exception:
            pass

    # 3) Remove o PDF do storage
    if arquivo_url:
        try:
            db.storage.from_("emissoes").remove([arquivo_url])
        except Exception:
            pass

    return {"ok": True}
