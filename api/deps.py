"""Base compartilhada das rotas: conexão com o banco, quem é o usuário, e o
recorte de carteira.

Ficava no topo do `api_routes.py`, que passou de 5.100 linhas. Como cada módulo
de rota precisa dessas cinco funções, elas viraram um lugar só — senão a
primeira separação já criaria import circular (rota importando `api_routes`, que
importa a rota).
"""

# Log da API: `logging`, nao `print` — o print nao chega ao log da Vercel.
from log import log

import os
from typing import Optional
from fastapi import HTTPException, Header  # type: ignore
from supabase import create_client, Client  # type: ignore

# Aplicado aqui porque TODO módulo de rota importa este arquivo — é o único
# ponto por onde a API inteira passa antes de falar com o banco. Ver
# `supabase_sem_none.py`: `maybe_single()` devolvia None e derrubou 83
# requisições em produção.
import supabase_sem_none as _sem_none
_sem_none.aplicar()

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
# Cache token→user em memória (TTL curto). Cada request pagava 2 idas ao Supabase
# (auth.get_user + profiles) ANTES de qualquer query útil — em rajadas de SWR isso
# dominava a latência. Com TTL de 120s, mudança de role/senha propaga em ≤2 min.
import time as _auth_time
import hashlib as _auth_hash
_user_cache: dict = {}          # sha256(token) -> (user_dict, expira_em)
_USER_CACHE_TTL = 120

_ja_dito: set = set()

def _diga_uma_vez(chave: str, msg: str):
    if chave not in _ja_dito:
        _ja_dito.add(chave)
        log.info(msg)


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token JWT ausente ou inválido")

    token = authorization.split(" ")[1]

    tkey = _auth_hash.sha256(token.encode()).hexdigest()
    now = _auth_time.time()
    hit = _user_cache.get(tkey)
    if hit and hit[1] > now:
        return dict(hit[0])

    db = get_db()

    # Valida token com o Supabase Auth.
    #
    # `get_user` LEVANTA quando a sessão não existe mais — entrar com outra conta
    # no mesmo navegador derruba a anterior, e o token guardado passa a apontar
    # para uma sessão que morreu. Sem este try, a exceção subia até o handler
    # global, virava 500, e a tela dizia "Erro de conexão — o servidor pode estar
    # iniciando". Mentira dupla: o servidor estava de pé, e "tentar novamente"
    # nunca ia resolver.
    #
    # Falha do Supabase Auth (rede, instância fora) é OUTRA coisa: aí 503, e a
    # sessão de quem está logado não é descartada por um problema que não é dele.
    user_id = email = None

    # Caminho rápido, DESLIGADO por padrão (`JWT_LOCAL=1` liga). O token vem
    # assinado e o projeto publica a chave pública, então dá para conferir aqui
    # sem ida à rede — ver `jwt_local.py`.
    #
    # Não é o padrão porque `profiles` não tem marca de "inativo": hoje quem
    # perde acesso perde pela SESSÃO, e é exatamente o `get_user` abaixo que
    # corta isso. Ligando, um token revogado continua entrando até expirar
    # sozinho (~1 h). É troca de ~200 ms por essa janela — decisão de quem
    # opera, não default meu.
    if os.getenv("JWT_LOCAL") == "1":
        import jwt_local
        try:
            claims = jwt_local.conferir(token)
            user_id, email = claims.get("sub"), claims.get("email")
            _diga_uma_vez("local", "[auth] conferindo o token aqui (sem ida a rede)")
        except jwt_local.NaoDaParaConferir as e:
            # Uma vez por processo, não por requisição: se o projeto ainda
            # assina com a chave antiga, o log diz isso sem virar enxurrada.
            _diga_uma_vez("rede", f"[auth] conferencia local nao deu ({e}); indo pela rede")
        except Exception:
            # Conferido e REPROVADO. Não vale tentar pela rede: o token é ruim.
            raise HTTPException(status_code=401, detail="Sessão expirada. Entre de novo.")

    if user_id is None:
        try:
            user_res = db.auth.get_user(token)
        except Exception as e:
            nome = type(e).__name__
            if "AuthApiError" in nome or "AuthSessionMissingError" in nome:
                raise HTTPException(status_code=401, detail="Sessão expirada. Entre de novo.")
            log.warning(f"[auth] Supabase Auth indisponível: {nome}: {e}")
            raise HTTPException(status_code=503, detail="Não consegui validar a sessão agora. Tente em instantes.")

        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="Token inválido ou expirado")

        user_id, email = user_res.user.id, user_res.user.email

    # O profile sai do cache de processo (mesma janela de 120 s que este cache
    # de token já praticava, e esvaziado por qualquer escrita nossa).
    #
    # `aquecer` primeiro: numa instância fria, perfil e as três tabelas da
    # carteira são quatro idas independentes. Em série custam ~1.170 ms; juntas,
    # o tempo da mais lenta. Quente, não faz nada.
    try:
        _ref.aquecer(db, user_id)
    except Exception as e:
        log.warning(f"[cache] aquecimento falhou ({type(e).__name__}); segue")
    try:
        profile = _ref.perfil(db, user_id)
    except Exception as e:
        log.warning(f"[cache] perfil indisponivel, consultando direto: {type(e).__name__}")
        prof_res = db.table("profiles").select("*").eq("id", user_id).single().execute()
        profile = prof_res.data if prof_res.data else {}

    # Acesso cortado (0121). Vem depois do perfil de propósito: é uma decisão
    # nossa, registrada numa coluna nossa, e não depende de a sessão ter sido
    # derrubada do outro lado. `True` quando a coluna ainda não existe, para a
    # API poder subir antes da migration rodar.
    if profile and profile.get("ativo", True) is False:
        raise HTTPException(
            status_code=401,
            detail="Seu acesso foi desativado. Fale com o administrador.",
        )

    if len(_user_cache) > 500:  # nunca cresce sem limite (instância serverless)
        _user_cache.clear()

    result = {
        "id": user_id,
        "email": email or profile.get("email", ""),
        "role": profile.get("role", "gerente"),
        "full_name": profile.get("full_name", ""),
        "must_change_password": bool(profile.get("must_change_password", False)),
        # gerente_id do PROFILE (vínculo assistente→gerente, migration 0057).
        # Já vem no SELECT * acima — evita re-consultar profiles em carteira_gerente_id.
        "gerente_id": profile.get("gerente_id"),
        # sinaliza que o profile já foi carregado (mesmo que gerente_id seja None)
        "_profile_loaded": True,
    }
    _user_cache[tkey] = (result, now + _USER_CACHE_TTL)
    return dict(result)

# O de-para gerente↔condomínio sai do cache de processo (`cache_ref`), não da
# rede. São três tabelas minúsculas consultadas em TODA requisição — e o banco
# está a 185 ms daqui. Cada função abaixo cai para a consulta direta se o cache
# falhar por qualquer motivo: o caminho antigo continua sendo o plano B.
import cache_ref as _ref


def get_gerente_id(db: Client, profile_id: str) -> Optional[str]:
    try:
        return _ref.gerente_id_do_profile(db, profile_id)
    except Exception as e:
        log.warning(f"[cache] gerentes indisponivel, consultando direto: {type(e).__name__}")
        res = db.table("gerentes").select("id").eq("profile_id", profile_id).execute()
        return res.data[0]["id"] if res.data else None

def gerente_condo_ids(db: Client, profile_id: str):
    """IDs dos condomínios sob a gerência do usuário (lista vazia se não for gerente / sem condos)."""
    g_id = get_gerente_id(db, profile_id)
    if not g_id:
        return []
    try:
        return _ref.condominios_do_gerente(db, g_id)
    except Exception as e:
        log.warning(f"[cache] condominios indisponivel, consultando direto: {type(e).__name__}")
        res = db.table("condominios").select("id").eq("gerente_id", g_id).execute()
        return [c["id"] for c in (res.data or [])]

def carteira_gerente_id(db: Client, user: dict):
    """gerentes.id da carteira do usuário — gerente: a sua; assistente: a do gerente vinculado."""
    role = user.get("role")
    if role == "gerente":
        return get_gerente_id(db, user["id"])
    if role == "assistente":
        # Reusa o gerente_id já carregado em get_current_user (evita 2ª consulta a profiles)
        if user.get("_profile_loaded"):
            gpid = user.get("gerente_id")
        else:
            try:
                prof = db.table("profiles").select("gerente_id").eq("id", user["id"]).maybe_single().execute()
                gpid = (prof.data or {}).get("gerente_id")
            except Exception:
                gpid = None  # coluna ainda não existe (migration 0057 não rodada)
        return get_gerente_id(db, gpid) if gpid else None
    return None

def condos_cobertos_por_ausencia(db: Client, user: dict):
    """Condomínios que este usuário responde HOJE por ausência de outro (0117).

    Espelha `condominios_por_ausencia()` do banco. Existe porque a API resolve
    carteira sozinha, do lado do servidor: sem isto, o substituto abre o painel e
    vê "0 condomínios" enquanto o RLS já o autoriza a aprovar aqueles pacotes.
    """
    uid = user.get("id")
    if not uid:
        return []
    try:
        # Uma consulta serve TODOS os substitutos — são pouquíssimas linhas —
        # e a data entra na chave, para uma cobertura não sobreviver à virada
        # do dia num processo que ficou de pé.
        return list(_ref.ausencias_de_hoje(db).get(uid, []))
    except Exception as e:
        # 0117 ainda nao rodou, ou o embed falhou: ninguem cobre ninguem.
        log.warning(f"[carteira] ausencias nao consultadas (segue sem): {type(e).__name__}")
        return []


def carteira_condo_ids(db: Client, user: dict):
    """IDs dos condomínios da carteira do usuário (gerente ou assistente vinculado),
    mais os que ele cobre por férias de outro gerente."""
    cobertos = condos_cobertos_por_ausencia(db, user)
    g_id = carteira_gerente_id(db, user)
    if not g_id:
        return cobertos
    try:
        proprios = _ref.condominios_do_gerente(db, g_id)
    except Exception as e:
        log.warning(f"[cache] condominios indisponivel, consultando direto: {type(e).__name__}")
        proprios = [c["id"] for c in (db.table("condominios").select("id").eq("gerente_id", g_id).execute().data or [])]
    return list(set(proprios) | set(cobertos))
