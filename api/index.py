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

# CORS travado: só origens conhecidas (prod + dev + previews do projeto no Vercel).
# Configurável por env ALLOWED_ORIGINS (lista separada por vírgula) sem mexer no código.
_DEFAULT_ORIGINS = "https://condominios-gamma.vercel.app,http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://condominios-[a-z0-9-]+\.vercel\.app",  # deploys de preview do projeto
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SECRET_KEY é OBRIGATÓRIA em produção — sem ela o cookie de sessão seria forjável.
# Em deploy (Vercel define VERCEL=1; na VPS defina PRODUCTION=1) falha o boot se faltar.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if os.getenv("VERCEL") or os.getenv("PRODUCTION"):
        raise RuntimeError("SECRET_KEY ausente — abortando boot (sessão seria forjável).")
    SECRET_KEY = "dev-key-inseguro-apenas-local"
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY)

# Import absoluto (Vercel não trata api/ como package Python)
import importlib, sys
_api_dir = os.path.dirname(os.path.abspath(__file__))
if _api_dir not in sys.path:
    sys.path.insert(0, _api_dir)
import api_routes
app.include_router(api_routes.router, prefix="/api", tags=["API NextJS"])

BASE_DIR = _api_dir
STATIC = os.path.join(BASE_DIR, "static")
# os.makedirs(STATIC, exist_ok=True) # Removido para compatibilidade com Vercel (Read-only filesystem)

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

# ═══ Log de erros / quebras (monitor da Auditoria) ════════════════════
import traceback as _tb

def log_erro(rota=None, metodo=None, status_code=500, mensagem=None, detalhe=None, user_id=None, user_nome=None):
    """Grava uma quebra na tabela audit_erros (best-effort; nunca levanta)."""
    try:
        get_db().table("audit_erros").insert({
            "rota": rota, "metodo": metodo, "status_code": status_code,
            "mensagem": (mensagem or "")[:500], "detalhe": (detalhe or "")[:4000],
            "user_id": user_id, "user_nome": user_nome,
        }).execute()
    except Exception as _e:
        print(f"[log_erro] falhou: {_e}")

@app.exception_handler(Exception)
async def _unhandled_exc_handler(request: Request, exc: Exception):
    """Captura exceções NÃO tratadas (500 reais = quebras de código) e registra na auditoria."""
    from fastapi.responses import JSONResponse
    u = None
    try:
        u = request.session.get("user")
    except Exception:
        pass
    log_erro(
        rota=str(request.url.path), metodo=request.method, status_code=500,
        mensagem=f"{type(exc).__name__}: {exc}", detalhe=_tb.format_exc(),
        user_id=(u or {}).get("id"), user_nome=(u or {}).get("full_name"),
    )
    print(f"[UNHANDLED] {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Erro interno do servidor."})

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

# ═══ RUN ═════════════════════════════════════════════════════════════
# Rotas legadas (Jinja/sessão-cookie) removidas — Next.js + api_routes.py cuidam de tudo.
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("index:app", host="0.0.0.0", port=8000, reload=True)
