"""CondoAdmin - Sistema de Gestão de Arrecadações de Condomínios"""
import os
import json
from datetime import datetime
from typing import Optional, Any, cast
from fastapi import FastAPI, Request, Form, Query  # type: ignore
from fastapi.templating import Jinja2Templates  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from fastapi.responses import RedirectResponse  # type: ignore
from starlette.middleware.sessions import SessionMiddleware  # type: ignore
from dotenv import load_dotenv  # type: ignore
from supabase import create_client, Client  # type: ignore
from fastapi.middleware.cors import CORSMiddleware # type: ignore

load_dotenv(override=True)

# ═══ App Setup ════════════════════════════════════════════════════════
app = FastAPI(title="CondoAdmin", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "dev-key"))

# Import absoluto (Vercel não trata api/ como package Python)
import importlib, sys
_api_dir = os.path.dirname(os.path.abspath(__file__))
if _api_dir not in sys.path:
    sys.path.insert(0, _api_dir)
import api_routes
app.include_router(api_routes.router, prefix="/api", tags=["API NextJS"])

BASE_DIR = _api_dir
STATIC = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC, exist_ok=True)

# Templates dummy — rotas legadas usam tpl() mas no deploy unificado o Next.js cuida do frontend
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates")) if os.path.isdir(os.path.join(BASE_DIR, "templates")) else None

# Cache headers for static files
from starlette.middleware import Middleware
from starlette.responses import Response

@app.middleware("http")
async def add_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        if request.url.path.endswith((".css", ".js")):
            response.headers["Cache-Control"] = "public, max-age=3600"  # 1 hour
        elif request.url.path.endswith(".json"):
            response.headers["Cache-Control"] = "public, max-age=86400"  # 1 day
    return response

# ═══ Supabase ═════════════════════════════════════════════════════════
SB_URL = os.getenv("SUPABASE_URL", "")
SB_ANON = os.getenv("SUPABASE_KEY", "")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY", "")

_db: Optional[Client] = None
_auth_client: Optional[Client] = None

def get_db() -> Client:
    global _db
    if _db is None:
        key = SB_SERVICE if SB_SERVICE else SB_ANON
        _db = create_client(SB_URL, key)
    return _db

def get_auth_client() -> Client:
    global _auth_client
    if _auth_client is None:
        _auth_client = create_client(SB_URL, SB_ANON)
    return _auth_client

# ═══ Helpers ══════════════════════════════════════════════════════════
def cur_user(req: Request) -> Optional[dict]:
    return req.session.get("user")

def set_flash(req: Request, msg: str, tipo: str = "success"):
    req.session["flash"] = {"message": msg, "type": tipo}

def pop_flash(req: Request) -> Optional[dict]:
    return req.session.pop("flash", None)

def tpl(req: Request, name: str, **kw):
    kw.setdefault("user", cur_user(req))
    kw.setdefault("flash", pop_flash(req))
    kw["request"] = req
    if templates is None:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Templates not available in serverless mode"})
    return templates.TemplateResponse(name, kw)

def current_semester():
    now = datetime.now()
    return now.year, (1 if now.month <= 6 else 2)

def sem_months(sem: int):
    return list(range(1, 7)) if sem == 1 else list(range(7, 13))

MESES = {1:"Janeiro",2:"Fevereiro",3:"Março",4:"Abril",5:"Maio",6:"Junho",
          7:"Julho",8:"Agosto",9:"Setembro",10:"Outubro",11:"Novembro",12:"Dezembro"}

# Cache do plano de contas
_plano_contas_cache: Optional[dict] = None

def load_plano_contas() -> dict:
    global _plano_contas_cache
    if _plano_contas_cache is None:
        path = os.path.join(STATIC, "plano_contas.json")
        with open(path, "r", encoding="utf-8") as f:
            _plano_contas_cache = json.load(f)
    return _plano_contas_cache

# In-memory cache para queries comuns (reduz round-trips ao Supabase)
import time
_query_cache: dict = {}
CACHE_TTL = 300  # 5 minutos

def cached_query(key: str, query_fn, ttl: int = CACHE_TTL):
    """Executa query com cache em memória."""
    now = time.time()
    if key in _query_cache:
        data, ts = _query_cache[key]
        if now - ts < ttl:
            return data
    result = query_fn()
    _query_cache[key] = (result, now)
    return result

def invalidate_cache(prefix: str = ""):
    """Limpa cache (opcionalmente por prefixo)."""
    global _query_cache
    if prefix:
        _query_cache = {k: v for k, v in _query_cache.items() if not k.startswith(prefix)}
    else:
        _query_cache = {}

def ensure_default_rateios(db: Client, condo_id: str, year: int):
    """Cria rateios padrão se o condomínio não tiver nenhum configurado."""
    existing = db.table("rateios_config").select("id").eq("condominio_id", condo_id).execute()
    if existing.data:
        return
    defaults = [
        {"ordem": 0, "nome": "CONDOMÍNIO", "conta_contabil": "01.003-00", "conta_nome": "CONDOMÍNIO"},
        {"ordem": 1, "nome": "FUNDO DE RESERVA", "conta_contabil": "03.000-00", "conta_nome": "FUNDO DE RESERVA"},
        {"ordem": 2, "nome": "CONSUMO ÁGUA / GÁS", "conta_contabil": "01.008-00", "conta_nome": "CONSUMO DE ÁGUA"},
    ]
    for d in defaults:
        d["condominio_id"] = condo_id
        res = db.table("rateios_config").insert(d).execute()
        if res.data:
            rid = res.data[0]["id"]
            for m in range(1, 13):
                val = "PLANILHA" if d["ordem"] == 2 else "0.00"
                db.table("rateios_valores").insert({"rateio_id": rid, "month": m, "ano": year, "valor": val}).execute()

# ═══ AUTH ROUTES ══════════════════════════════════════════════════════
@app.get("/")
def login_page(request: Request):
    if cur_user(request):
        return RedirectResponse("/dashboard", 303)
    return tpl(request, "login.html")

@app.post("/login")
def login(request: Request, email: str = Form(...), senha: str = Form(...)):
    try:
        sb = get_auth_client()
        res = sb.auth.sign_in_with_password({"email": email, "password": senha})
        uid = str(res.user.id)
        token = res.session.access_token

        role, full_name = "outros", email.split("@")[0].title()
        try:
            db = get_db()
            p = db.table("profiles").select("role,full_name").eq("id", uid).single().execute()
            if p.data:
                role = p.data.get("role", role)
                full_name = p.data.get("full_name", full_name)
                print(f"[LOGIN] {email} -> role={role}, name={full_name}")
        except Exception as profile_err:
            print(f"[LOGIN] ERRO ao buscar profile para {email} (uid={uid}): {profile_err}")
            # Tentar buscar por email como fallback
            try:
                p2 = db.table("profiles").select("role,full_name").eq("email", email).execute()
                if p2.data:
                    role = p2.data[0].get("role", role)
                    full_name = p2.data[0].get("full_name", full_name)
                    print(f"[LOGIN] Fallback por email OK: role={role}")
            except Exception:
                pass

        request.session["user"] = {
            "id": uid, "email": email, "role": role,
            "full_name": full_name, "access_token": token,
        }
        return RedirectResponse("/dashboard", 303)
    except Exception as e:
        print(f"[LOGIN] Falha de autenticação para {email}: {e}")
        return tpl(request, "login.html", erro="Email ou senha incorretos.")

@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/", 303)

# ═══ DASHBOARD ════════════════════════════════════════════════════════
@app.get("/dashboard")
def dashboard(request: Request, gerente_id: str = Query(None)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)

    db = get_db()
    year, sem = current_semester()
    condos, gerentes, proc_map = [], [], {}

    try:
        # Cache condominios (raramente mudam)
        def fetch_condos():
            return db.table("condominios").select("id,name,due_day,gerente_id").order("name").execute().data or []
        all_condos = cached_query("condominios_list", fetch_condos)
        
        # Filtrar por gerente no Python (evita query extra)
        if gerente_id:
            condos = [c for c in all_condos if c.get("gerente_id") == gerente_id]
        else:
            condos = list(all_condos)

        # Cache gerentes
        def fetch_gerentes():
            return db.table("gerentes").select("id,profiles(full_name)").execute().data or []
        gerentes = cached_query("gerentes_list", fetch_gerentes)
        
        gnames = {}
        for g in gerentes:
            pr = g.get("profiles")
            if isinstance(pr, dict):
                gnames[g["id"]] = pr.get("full_name", "—")
            elif isinstance(pr, list) and pr:
                gnames[g["id"]] = pr[0].get("full_name", "—")
            else:
                gnames[g["id"]] = "—"
        for c in condos:
            c["gerente_name"] = gnames.get(c.get("gerente_id"), "Sem gerente")

        # Processos do semestre atual (TTL curto = 60s)
        def fetch_procs():
            return db.table("processos").select("id,condominio_id,status").eq("year", year).eq("semester", sem).execute().data or []
        procs_data = cached_query(f"processos_{year}_{sem}", fetch_procs, ttl=60)
        for p in procs_data:
            proc_map[p["condominio_id"]] = p
    except Exception as e:
        set_flash(request, f"Erro ao carregar dados: {str(e)}", "error")

    sts = [p.get("status","") for p in proc_map.values()]
    stats = {
        "total": len(condos),
        "em_edicao": sts.count("Em edição") + sts.count("Solicitar alteração"),
        "pendentes": sts.count("Enviado") + sts.count("Em aprovação"),
        "aprovados": sts.count("Aprovado") + sts.count("Emitido"),
    }

    return tpl(request, "dashboard.html", condos=condos, gerentes=gerentes,
               processos=proc_map, stats=stats, filtro_gerente=gerente_id,
               year=year, semester=sem, page="dashboard")

# ═══ ARRECADAÇÕES ═════════════════════════════════════════════════════
@app.get("/condominio/{condo_id}/arrecadacoes")
def arrecadacoes_view(request: Request, condo_id: str, ano: int = Query(None)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    
    # Define o ano selecionado (padrão: atual)
    year = ano or datetime.now().year
    months = list(range(1, 13))  # 12 meses (Visão Anual)

    # Carregar condomínio e gerente (com cache)
    try:
        def fetch_condo_detail():
            return db.table("condominios").select("*, gerente:gerente_id(profiles(full_name))").eq("id", condo_id).execute().data
        condo_data = cached_query(f"condo_{condo_id}", fetch_condo_detail)
        condo = condo_data[0] if condo_data else None
        if condo and condo.get("gerente"):
            p = condo["gerente"].get("profiles")
            if isinstance(p, dict):
                condo["gerente_name"] = p.get("full_name", "—")
            elif isinstance(p, list) and p:
                condo["gerente_name"] = p[0].get("full_name", "—")
    except Exception as e:
        print(f"Erro ao carregar condo: {e}")
        condo = None

    if not condo:
        set_flash(request, "Condomínio não encontrado.", "error")
        return RedirectResponse("/dashboard", 303)

    # Busca o processo apenas para fins de status e permissões
    processo = None
    try:
        # Nota: Processos ainda podem ser semestrais na DB, 
        # mas aqui pegamos o do 1º semestre como referência de status do ano ou buscamos um do ano.
        processo = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", year).execute().data
        processo = processo[0] if processo else None
    except Exception:
        pass

    # Carregar rateios (agora vinculados ao condomínio, mantendo ordem)
    rateios = []
    rateios_vals = {}
    try:
        ensure_default_rateios(db, condo_id, year)
        rateios_res = db.table("rateios_config").select("*").eq("condominio_id", condo_id).order("ordem").execute()
        rateios = rateios_res.data or []
        
        if rateios:
            rids = [r["id"] for r in rateios]
            vals_res = db.table("rateios_valores").select("*").in_("rateio_id", rids).eq("ano", year).execute().data
            for v in (vals_res or []):
                rid = v["rateio_id"]
                if rid not in rateios_vals: rateios_vals[rid] = {}
                rateios_vals[rid][v["month"]] = v["valor"]
    except Exception as e:
        print(f"Erro ao carregar rateios: {e}")

    # Plano de contas
    plano_id = str(condo.get("plano_contas_id", 1))
    plano_data = load_plano_contas()
    contas = plano_data.get(plano_id, plano_data.get("1", {})).get("contas", [])

    # Anos para o seletor
    years_range = range(datetime.now().year - 5, datetime.now().year + 6)

    can_edit = True
    if processo and processo.get("status") not in ("Em edição", "Solicitar alteração"):
        can_edit = False

    return tpl(request, "arrecadacoes.html", condo=condo, processo=processo,
               rateios=rateios, rateios_vals=rateios_vals, plano_id=plano_id,
               months=months, month_names=MESES,
               can_edit=can_edit, year=year, semester=datetime.now().month // 7 + 1,
               years=years_range, page="arrecadacoes")

@app.post("/condominio/{condo_id}/arrecadacoes/salvar")
async def salvar_arrecadacoes(request: Request, condo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    
    body = await request.form()
    current_year = int(body.get("ano", datetime.now().year))
    action = body.get("action") 

    try:
        # Tenta buscar o processo para o ano selecionado
        processo = db.table("processos").select("id,status").eq("condominio_id", condo_id).eq("year", current_year).execute().data
        processo = processo[0] if processo else None
    except Exception:
        processo = None

    if processo and processo.get("status") not in ("Em edição", "Solicitar alteração"):
        set_flash(request, "Processo bloqueado para edição.", "error")
        return RedirectResponse(f"/condominio/{condo_id}/arrecadacoes?ano={current_year}", 303)

    obs_emissao = body.get("obs_emissao")
    if obs_emissao is not None and processo:
        try:
            db.table("processos").update({"issue_notes": obs_emissao}).eq("id", processo["id"]).execute()
        except Exception:
            pass

    # Salvar rateios dinâmicos
    rateio_ids = body.getlist("rateio_ids")
    for idx, rid in enumerate(rateio_ids, 1):
        nome = body.get(f"rateio_nome_{rid}")
        conta = body.get(f"conta_id_{rid}")
        conta_nome_field = body.get(f"conta_nome_{rid}")
        
        is_p = body.get(f"is_parcelado_{rid}") == "on"
        p_total = body.get(f"parcela_total_{rid}", "1")
        p_inicio = body.get(f"parcela_inicio_{rid}", "1")
        m_inicio = body.get(f"mes_inicio_{rid}", "1")

        try:
            db.table("rateios_config").update({
                "nome": nome, "conta_contabil": conta,
                "conta_nome": conta_nome_field, "ordem": idx,
                "is_parcelado": is_p,
                "parcela_total": int(p_total) if p_total else 1,
                "parcela_inicio": int(p_inicio) if p_inicio else 1,
                "mes_inicio": int(m_inicio) if m_inicio else 1
            }).eq("id", rid).execute()
            
            # Salvar valores mensais (1-12) para o ano selecionado
            for m in range(1, 13):
                val = body.get(f"val_{rid}_{m}")
                if val is not None:
                    db.table("rateios_valores").upsert({
                        "rateio_id": rid,
                        "month": m,
                        "ano": current_year,
                        "valor": val
                    }, on_conflict="rateio_id, month, ano").execute()
        except Exception:
            pass

    if action == "add":
        try:
            db.table("rateios_config").insert({
                "condominio_id": condo_id,
                "nome": "NOVO RATEIO",
                "ordem": len(rateio_ids) + 1
            }).execute()
            set_flash(request, "Novo rateio adicionado.", "success")
        except Exception as e:
            set_flash(request, f"Erro ao adicionar rateio: {str(e)}", "error")
    else:
        set_flash(request, "Alterações salvas com sucesso!", "success")

    return RedirectResponse(f"/condominio/{condo_id}/arrecadacoes?ano={current_year}", 303)

@app.post("/rateio/{rateio_id}/remover")
async def remover_rateio(request: Request, rateio_id: str, condo_id: str = Form(...)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    try:
        # Busca o ano selecionado para redirecionar corretamente
        body = await request.form()
        current_year = body.get("ano", datetime.now().year)
        
        db.table("rateios_valores").delete().eq("rateio_id", rateio_id).execute()
        db.table("rateios_config").delete().eq("id", rateio_id).execute()
        set_flash(request, "Rateio removido!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
        current_year = datetime.now().year
    return RedirectResponse(f"/condominio/{condo_id}/arrecadacoes?ano={current_year}", 303)

# ═══ API PLANO DE CONTAS ══════════════════════════════════════════════
@app.get("/api/plano-contas/{plano_id}")
def api_plano_contas(request: Request, plano_id: int, tipo: str = Query(None)):
    user = cur_user(request)
    if not user:
        return {"error": "Não autenticado"}
    plano_data = load_plano_contas()
    contas = plano_data.get(str(plano_id), plano_data.get("1", {})).get("contas", [])
    if tipo:
        contas = [c for c in contas if c.get("tipo", "").lower() == tipo.lower()]
    return {"contas": contas}

@app.post("/processo/{processo_id}/enviar")
def enviar_processo(request: Request, processo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    try:
        proc = db.table("processos").select("condominio_id,status").eq("id", processo_id).single().execute().data
        if proc["status"] not in ("Em edição", "Solicitar alteração"):
            set_flash(request, "Processo não pode ser enviado neste status.", "error")
        else:
            db.table("processos").update({"status": "Enviado", "updated_at": datetime.utcnow().isoformat()}).eq("id", processo_id).execute()
            db.table("aprovacoes").insert({"processo_id": processo_id, "approver_id": user["id"], "action": "Enviado", "comment": "Enviado para aprovação"}).execute()
            set_flash(request, "Processo enviado para aprovação!")
        return RedirectResponse(f"/condominio/{proc['condominio_id']}/arrecadacoes", 303)
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
        return RedirectResponse("/dashboard", 303)

# ═══ COBRANÇAS EXTRAS ═════════════════════════════════════════════════
@app.get("/condominio/{condo_id}/cobrancas-extras")
def cobrancas_page(request: Request, condo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    year, sem = current_semester()

    # Carregar condomínio e gerente
    try:
        res = db.table("condominios").select("*, gerente:gerente_id(profiles(full_name))").eq("id", condo_id).execute()
        condo = res.data[0] if res.data else None
        if condo and condo.get("gerente"):
            p = condo["gerente"].get("profiles")
            if isinstance(p, dict):
                condo["gerente_name"] = p.get("full_name", "—")
            elif isinstance(p, list) and p:
                condo["gerente_name"] = p[0].get("full_name", "—")
    except Exception as e:
        print(f"Erro ao carregar condo: {e}")
        condo = None

    if not condo:
        set_flash(request, "Condomínio não encontrado.", "error")
        return RedirectResponse("/dashboard", 303)

    processo = None
    try:
        processo = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", year).eq("semester", sem).single().execute().data
    except Exception:
        pass

    cobrancas = []
    if processo:
        try:
            cobrancas = db.table("cobrancas_extras").select("*").eq("processo_id", processo["id"]).order("created_at").execute().data or []
        except Exception:
            pass

    can_edit = processo and processo.get("status") in ("Em edição", "Solicitar alteração")
    return tpl(request, "cobrancas_extras.html", condo=condo, processo=processo,
               cobrancas=cobrancas, can_edit=can_edit, page="cobrancas")

@app.post("/condominio/{condo_id}/cobrancas-extras/adicionar")
def adicionar_cobranca(request: Request, condo_id: str,
                       descricao: str = Form(...), valor: str = Form(...)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    year, sem = current_semester()
    try:
        proc = db.table("processos").select("id,status").eq("condominio_id", condo_id).eq("year", year).eq("semester", sem).single().execute().data
        if proc["status"] not in ("Em edição", "Solicitar alteração"):
            set_flash(request, "Processo bloqueado.", "error")
        else:
            val = float(valor.replace(".", "").replace(",", "."))
            db.table("cobrancas_extras").insert({"processo_id": proc["id"], "description": descricao, "amount": val}).execute()
            set_flash(request, "Cobrança adicionada!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)

@app.post("/cobranca-extra/{cobranca_id}/remover")
def remover_cobranca(request: Request, cobranca_id: str, condo_id: str = Form(...)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    try:
        db = get_db()
        db.table("cobrancas_extras").delete().eq("id", cobranca_id).execute()
        set_flash(request, "Cobrança removida!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)

# ═══ APROVAÇÕES ═══════════════════════════════════════════════════════
@app.get("/aprovacoes")
def aprovacoes_page(request: Request):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()

    pendentes = []
    try:
        procs = db.table("processos").select("*, condominios(name, gerente_id, gerentes(profiles(full_name)))").in_("status", ["Enviado", "Em aprovação"]).execute()
        pendentes = procs.data or []
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")

    historico = []
    try:
        hist = db.table("aprovacoes").select("*, processos(condominios(name)), profiles:approver_id(full_name)").order("created_at", desc=True).limit(20).execute()
        historico = hist.data or []
    except Exception:
        pass

    return tpl(request, "aprovacoes.html", pendentes=pendentes, historico=historico, page="aprovacoes")

@app.post("/processo/{processo_id}/aprovar")
def aprovar_processo(request: Request, processo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    try:
        db.table("processos").update({"status": "Aprovado", "updated_at": datetime.utcnow().isoformat()}).eq("id", processo_id).execute()
        db.table("aprovacoes").insert({"processo_id": processo_id, "approver_id": user["id"], "action": "Aprovado", "comment": "Processo aprovado"}).execute()
        set_flash(request, "Processo aprovado com sucesso!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse("/aprovacoes", 303)

@app.post("/processo/{processo_id}/solicitar-alteracao")
def solicitar_alteracao(request: Request, processo_id: str, comentario: str = Form(...)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    try:
        db.table("processos").update({"status": "Solicitar alteração", "updated_at": datetime.utcnow().isoformat()}).eq("id", processo_id).execute()
        db.table("aprovacoes").insert({"processo_id": processo_id, "approver_id": user["id"], "action": "Solicitar alteração", "comment": comentario}).execute()
        set_flash(request, "Alteração solicitada.")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse("/aprovacoes", 303)

# ═══ CARTEIRAS (PASTAS POR GERENTE) ═════════════════════════════════════
@app.get("/carteiras")
def ver_carteiras(request: Request):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    
    db = get_db()
    
    # 1. Fetch gerentes (with cache)
    gerentes_data = cached_query("gerentes", lambda: db.table("gerentes").select("*, profiles:profile_id(full_name)").execute().data)
    gerentes = gerentes_data or []
    
    # 2. Map gerentes
    gerentes_map = {}
    for g in gerentes:
        p = g.get("profiles")
        if isinstance(p, dict):
            nome = p.get("full_name", "—")
        elif isinstance(p, list) and p:
            nome = p[0].get("full_name", "—")
        else:
            nome = "Gerente sem Nome"
        gerentes_map[g["id"]] = {"id": g["id"], "nome": nome, "assistente": g.get("assistente") or "—", "condominios": [], "count": 0}
        
    sem_gerente = {"id": None, "nome": "Sem Gerente Atribuído", "assistente": "—", "condominios": [], "count": 0}
    
    # 3. Fetch condos (with cache)
    condos = cached_query("condominios", lambda: db.table("condominios").select("*").order("name").execute().data)
    for c in (condos or []):
        gid = c.get("gerente_id")
        if gid and gid in gerentes_map:
            gerentes_map[gid]["condominios"].append(c)
            gerentes_map[gid]["count"] += 1
        else:
            sem_gerente["condominios"].append(c)
            sem_gerente["count"] += 1
            
    # 4. Filter empty and sort
    carteiras = list(gerentes_map.values())
    carteiras.sort(key=lambda x: x["nome"])
    if sem_gerente["count"] > 0:
        carteiras.append(sem_gerente)
    
    return tpl(request, "carteiras.html", carteiras=carteiras, page="carteiras")

# ═══ ADMIN: GESTÃO DE USUÁRIOS ════════════════════════════════════════
@app.get("/admin/usuarios")
def admin_usuarios(request: Request):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        set_flash(request, "Acesso restrito.", "error")
        return RedirectResponse("/dashboard", 303)
    db = get_db()
    usuarios = []
    try:
        usuarios = db.table("profiles").select("*").order("full_name").execute().data or []
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return tpl(request, "admin_usuarios.html", usuarios=usuarios, page="admin")

@app.post("/admin/usuarios/{uid}/role")
def change_role(request: Request, uid: str, role: str = Form(...)):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        return RedirectResponse("/dashboard", 303)
    db = get_db()
    try:
        db.table("profiles").update({"role": role}).eq("id", uid).execute()
        set_flash(request, "Papel atualizado!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse("/admin/usuarios", 303)

@app.post("/admin/usuarios/criar")
def criar_usuario(request: Request, nome: str = Form(...), email: str = Form(...),
                  senha: str = Form(...), role: str = Form("gerente")):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        return RedirectResponse("/dashboard", 303)
    if not SB_SERVICE:
        set_flash(request, "SUPABASE_SERVICE_KEY não configurada. Configure no .env para criar usuários.", "error")
        return RedirectResponse("/admin/usuarios", 303)
    try:
        admin_sb = create_client(SB_URL, SB_SERVICE)
        res = admin_sb.auth.admin.create_user({"email": email, "password": senha, "email_confirm": True})
        uid = str(res.user.id)
        admin_sb.table("profiles").insert({"id": uid, "email": email, "full_name": nome, "role": role}).execute()
        set_flash(request, f"Usuário {nome} criado com sucesso!")
    except Exception as e:
        set_flash(request, f"Erro ao criar: {str(e)}", "error")
    return RedirectResponse("/admin/usuarios", 303)

@app.post("/admin/usuarios/{uid}/remover")
def remover_usuario(request: Request, uid: str):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        return RedirectResponse("/dashboard", 303)
    try:
        db = get_db()
        db.table("profiles").delete().eq("id", uid).execute()
        if SB_SERVICE:
            admin_sb = create_client(SB_URL, SB_SERVICE)
            admin_sb.auth.admin.delete_user(uid)
        set_flash(request, "Usuário removido!")
    except Exception as e:
        set_flash(request, f"Erro: {str(e)}", "error")
    return RedirectResponse("/admin/usuarios", 303)

# ═══ ADMIN: GESTÃO DE CONDOMÍNIOS ════════════════════════════════════
@app.get("/admin/condominios")
def admin_condominios(request: Request, busca: str = Query(None)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    
    db = get_db()
    try:
        q = db.table("condominios").select("*, gerentes(id, profiles(full_name))").order("name")
        if busca:
            q = q.ilike("name", f"%{busca}%")
        
        res = q.execute()
        condos = res.data or []
        
        # Formata nomes dos gerentes para o template
        for c in condos:
            g = c.get("gerentes")
            c["gerente_name"] = "—"
            if g:
                p = g.get("profiles")
                if isinstance(p, dict):
                    c["gerente_name"] = p.get("full_name", "—")
                elif isinstance(p, list) and p:
                    c["gerente_name"] = p[0].get("full_name", "—")

        ger_res = db.table("gerentes").select("id, profiles(full_name)").execute()
        gerentes = ger_res.data or []
        
        return tpl(request, "admin_condominios.html", condos=condos, 
                   gerentes=gerentes, busca=busca, page="condominios")
    except Exception as e:
        set_flash(request, f"Erro ao carregar: {str(e)}", "error")
        return RedirectResponse("/dashboard", 303)

@app.post("/admin/condominios/salvar")
async def salvar_condominio(request: Request):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        set_flash(request, "Acesso negado.", "error")
        return RedirectResponse("/dashboard", 303)
    
    body = await request.form()
    cid = body.get("id")
    nome = body.get("nome")
    gid = body.get("gerente_id")
    due = body.get("due_day")
    lg = body.get("limit_gerencia")
    le = body.get("limit_emissao")
    lx = body.get("limit_expedicao")
    obs = body.get("obs_emissao")
    plano = body.get("plano_contas_id")

    data = {
        "name": nome,
        "due_day": int(due) if due else None,
        "gerente_id": gid if gid else None,
        "limit_gerencia": int(lg) if lg else None,
        "limit_emissao": int(le) if le else None,
        "limit_expedicao": int(lx) if lx else None,
        "obs_emissao": obs,
        "plano_contas_id": int(plano) if plano else 1
    }

    db = get_db()
    try:
        if cid:
            db.table("condominios").update(data).eq("id", cid).execute()
            set_flash(request, "Condomínio atualizado com sucesso!")
        else:
            db.table("condominios").insert(data).execute()
            set_flash(request, "Condomínio cadastrado com sucesso!")
    except Exception as e:
        set_flash(request, f"Erro ao salvar: {str(e)}", "error")
    
    return RedirectResponse("/admin/condominios", 303)

@app.post("/admin/condominios/{uid}/remover")
def remover_condominio(request: Request, uid: str):
    user = cur_user(request)
    if not user or user.get("role") != "master":
        return RedirectResponse("/dashboard", 303)
    
    db = get_db()
    try:
        db.table("condominios").delete().eq("id", uid).execute()
        set_flash(request, "Condomínio removido!")
    except Exception as e:
        set_flash(request, f"Erro ao remover: {str(e)}", "error")
    
    return RedirectResponse("/admin/condominios", 303)

# ═══ COBRANÇAS EXTRAS ══════════════════════════════════════════════════
from fastapi import UploadFile, File  # type: ignore
import shutil, uuid as uuid_mod

UPLOADS_DIR = os.path.join(STATIC, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".xlsx", ".xls", ".csv"}

@app.get("/condominio/{condo_id}/cobrancas-extras")
def cobrancas_extras_view(request: Request, condo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    db = get_db()
    year, sem = current_semester()

    # Condo
    condo_data = cached_query(f"condo_{condo_id}", lambda: db.table("condominios").select("*").eq("id", condo_id).execute().data)
    condo = condo_data[0] if condo_data else None
    if not condo:
        set_flash(request, "Condomínio não encontrado.", "error")
        return RedirectResponse("/admin/condominios", 303)

    # Processo
    processo = None
    can_edit = False
    try:
        proc = db.table("processos").select("*").eq("condominio_id", condo_id).eq("year", year).eq("semester", sem).execute().data
        processo = proc[0] if proc else None
        if processo and processo.get("status") in ("Em edição", "Solicitar alteração"):
            can_edit = True
    except Exception:
        pass

    if user.get("role") == "master":
        can_edit = True

    # Cobranças
    cobrancas = []
    try:
        cobrancas = db.table("cobrancas_extras").select("*").eq("condominio_id", condo_id).order("created_at", desc=True).execute().data or []
    except Exception:
        pass

    # Arquivos locais
    condo_uploads = os.path.join(UPLOADS_DIR, condo_id)
    arquivos = []
    if os.path.exists(condo_uploads):
        for f in sorted(os.listdir(condo_uploads)):
            fpath = os.path.join(condo_uploads, f)
            ext = os.path.splitext(f)[1].lower()
            size_kb = os.path.getsize(fpath) / 1024
            arquivos.append({
                "name": f,
                "ext": ext,
                "size": f"{size_kb:.0f} KB" if size_kb < 1024 else f"{size_kb/1024:.1f} MB",
                "is_image": ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp"),
                "url": f"/static/uploads/{condo_id}/{f}"
            })

    return tpl(request, "cobrancas_extras.html", condo=condo, processo=processo,
               cobrancas=cobrancas, can_edit=can_edit, arquivos=arquivos, page="condominios")


@app.post("/condominio/{condo_id}/cobrancas-extras/adicionar")
async def adicionar_cobranca(request: Request, condo_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    body = await request.form()
    desc = body.get("descricao", "")
    val_str = body.get("valor", "0").replace(".", "").replace(",", ".")
    try:
        valor = float(val_str)
    except ValueError:
        valor = 0.0

    db = get_db()
    try:
        db.table("cobrancas_extras").insert({
            "condominio_id": condo_id,
            "description": desc,
            "amount": valor,
        }).execute()
        set_flash(request, "Cobrança extra adicionada!")
    except Exception as e:
        set_flash(request, f"Erro: {e}", "error")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)


@app.post("/cobranca-extra/{cb_id}/remover")
async def remover_cobranca(request: Request, cb_id: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    body = await request.form()
    condo_id = body.get("condo_id", "")
    db = get_db()
    try:
        db.table("cobrancas_extras").delete().eq("id", cb_id).execute()
        set_flash(request, "Cobrança removida!")
    except Exception as e:
        set_flash(request, f"Erro: {e}", "error")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)


@app.post("/condominio/{condo_id}/upload")
async def upload_arquivo(request: Request, condo_id: str, arquivo: UploadFile = File(...)):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)

    ext = os.path.splitext(arquivo.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        set_flash(request, f"Tipo de arquivo não permitido: {ext}. Use PDF, imagem ou Excel.", "error")
        return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)

    condo_uploads = os.path.join(UPLOADS_DIR, condo_id)
    os.makedirs(condo_uploads, exist_ok=True)

    # Nome seguro
    safe_name = f"{uuid_mod.uuid4().hex[:8]}_{arquivo.filename}"
    dest = os.path.join(condo_uploads, safe_name)

    with open(dest, "wb") as f:
        content = await arquivo.read()
        f.write(content)

    set_flash(request, f"Arquivo '{arquivo.filename}' enviado com sucesso!")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)


@app.post("/condominio/{condo_id}/arquivo/{filename}/remover")
def remover_arquivo(request: Request, condo_id: str, filename: str):
    user = cur_user(request)
    if not user:
        return RedirectResponse("/", 303)
    fpath = os.path.join(UPLOADS_DIR, condo_id, filename)
    if os.path.exists(fpath):
        os.remove(fpath)
        set_flash(request, "Arquivo removido!")
    else:
        set_flash(request, "Arquivo não encontrado.", "error")
    return RedirectResponse(f"/condominio/{condo_id}/cobrancas-extras", 303)

# ═══ RUN ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn  # type: ignore
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
# end of file
