# CONTEXTO DO PROJETO CONDFLOW

Este arquivo contém o código fonte dos principais arquivos do projeto para que o Claude possa entender a lógica atual.

## Arquivo: api/api_routes.py
```python
import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, Request # type: ignore
from supabase import create_client, Client # type: ignore
from pydantic import BaseModel # type: ignore

router = APIRouter()

# Supabase Client setup
SB_URL = os.getenv("SUPABASE_URL", "")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY", "")

def get_db() -> Client:
    return create_client(SB_URL, SB_SERVICE)

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
        "full_name": profile.get("full_name", "")
    }

def get_gerente_id(db: Client, profile_id: str) -> Optional[str]:
    res = db.table("gerentes").select("id").eq("profile_id", profile_id).execute()
    if res.data:
        return res.data[0]["id"]
    return None

# ═══ API ENDPOINTS ═══════════════════════════════════════════════════

@router.get("/dashboard")
def api_dashboard(gerente_id: Optional[str] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        from datetime import datetime
        year = datetime.now().year
        sem = 1 if datetime.now().month <= 6 else 2

        query = db.table("condominios").select("*, processos(*)")
        
        # Filtros baseados na role
        if user["role"] == "gerente":
            g_id = get_gerente_id(db, user["id"])
            if g_id:
                query = query.eq("gerente_id", g_id)
            else:
                query = query.eq("gerente_id", "00000000-0000-0000-0000-000000000000")
        elif gerente_id and user["role"] in ["master", "supervisora", "supervisora_contabilidade"]:
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
            gerentes = db.table("gerentes").select("id, profiles!gerentes_profile_id_fkey(full_name)").execute().data

        return {
            "year": year, 
            "semester": sem, 
            "stats": stats, 
            "condos": condos,
            "processos": processos,
            "gerentes": gerentes
        }
    except Exception as e:
        print(f"ERROR /dashboard: {e}")
        raise HTTPException(500, str(e))

@router.get("/condominios")
def api_condominios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        query = db.table("condominios").select("*").order("name")
        
        if user["role"] == "gerente":
            g_id = get_gerente_id(db, user["id"])
            if g_id:
                query = query.eq("gerente_id", g_id)
            else:
                query = query.eq("gerente_id", "00000000-0000-0000-0000-000000000000")
                
        condos = query.execute().data
        return {"condos": condos}
    except Exception as e:
        raise HTTPException(500, str(e))

class CondoData(BaseModel):
    id: Optional[str] = None
    name: str
    due_day: str
    gerente_id: str
    assistente: str

@router.post("/condominios/salvar")
def api_salvar_condominio(data: CondoData, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] != "master":
            raise HTTPException(403, "Apenas master")
        
        payload = {"name": data.name, "due_day": data.due_day, "gerente_id": data.gerente_id, "assistente": data.assistente}
        
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
        # pending approval
        pendentes_res = db.table("processos").select("id, year, semester, status, condominios(name)").in_('status', ['Enviado', 'Em aprovação']).execute().data
        # historico
        hist_res = db.table("aprovacoes").select("id, action, comment, created_at, profiles(full_name), processos(year, semester, condominios(name))").order('created_at', desc=True).limit(20).execute().data
        
        return {
            "pendentes": pendentes_res or [],
            "historico": hist_res or []
        }
    except Exception as e:
        print(f"CRITICAL ERROR /aprovacoes: {e}")
        return {"pendentes": [], "historico": [], "error": str(e)}

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
        if user["role"] not in ["master", "emissor"]:
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
        if user["role"] not in ["master", "emissor"]:
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

class CreateUserSchema(BaseModel):
    email: str
    password: str
    full_name: str
    role: str

@router.post("/usuarios")
def api_criar_usuario(data: CreateUserSchema, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas administradores podem criar usuários")
    
    if not SB_SERVICE:
        raise HTTPException(500, "Service Key não configurada no servidor")

    try:
        # 1. Criar no Auth
        auth_res = db.auth.admin.create_user({
            "email": data.email,
            "password": data.password,
            "email_confirm": True
        })
        uid = auth_res.user.id

        # 2. Criar no Profiles
        db.table("profiles").upsert({
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role
        }).execute()

        # 3. Se for gerente, garantir registro na tabela gerentes
        if data.role == "gerente":
            db.table("gerentes").upsert({
                "profile_id": uid
            }, on_conflict="profile_id").execute()

        return {"success": True, "id": uid}
    except Exception as e:
        raise HTTPException(400, str(e))

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
            target_user = next((u for u in users_list if u.email == data.email), None)
            
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
            "gerente_id": g["id"] if g else None,
            "condominios": g["condominios"] if g else []
        })
    
    return {"usuarios": result}

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

ROLES_APROVADORES = ['master', 'gerente', 'supervisora', 'supervisora_contabilidade']
ROLES_EMISSORES = ['master', 'emissor']
ROLES_LANCA_COBRANCAS = ['master', 'gerente', 'assistente']


def require_role(user: dict, roles: list):
    """Levanta 403 se o usuario nao tiver um dos roles permitidos."""
    if user.get('role') not in roles:
        raise HTTPException(403, f"Acesso negado. Requer role: {', '.join(roles)}")


# ═══ Endpoint: Dados de conferência (Planilha + Cobranças) ════════════

@router.get("/condominio/{condo_id}/conferencia")
def api_dados_conferencia(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    """
    Retorna dados de apoio para conferir um documento (Espelho em Tempo Real).
    Sempre retorna a estrutura dos 12 meses, mesmo que zerada.
    """
    import traceback, re
    year = datetime.now().year

    def parse_valor(v) -> float:
        """Converte string monetária brasileira para float.
        Exemplos: '30.000.00' -> 30000.00, '1.500,50' -> 1500.50, '500' -> 500.0
        """
        if v is None:
            return 0.0
        s = str(v).strip()
        if not s:
            return 0.0
        # Remove R$ e espaços
        s = s.replace('R$', '').replace(' ', '')
        # Se tem vírgula, ela é o separador decimal (BR)
        if ',' in s:
            s = s.replace('.', '').replace(',', '.')
        else:
            # Sem vírgula: último ponto pode ser decimal se tiver mais de 2 pontos
            parts = s.split('.')
            if len(parts) > 2:
                # Ex: '30.000.00' -> '30000.00'
                s = ''.join(parts[:-1]) + '.' + parts[-1]
        try:
            return float(s)
        except ValueError:
            return 0.0

    # Inicializa os 12 meses com zeros
    meses = []
    for m in range(1, 13):
        meses.append({
            'mes': m,
            'mes_nome': MESES_PT.get(m, str(m)),
            'condominio': 0.0,
            'fundo_reserva': 0.0,
            'total': 0.0,
        })

    total_condo = total_fundo = total_geral = 0

    try:
        rateios = db.table("rateios_config").select("id, nome").eq("condominio_id", condo_id).order("ordem").execute().data or []
        if rateios:
            r_ids = [r["id"] for r in rateios]
            vals = db.table("rateios_valores").select("*").in_("rateio_id", r_ids).eq("ano", year).execute().data or []

            if not vals:
                last_res = db.table("rateios_valores").select("ano").in_("rateio_id", r_ids).order("ano", desc=True).limit(1).execute()
                if last_res.data:
                    year = last_res.data[0]["ano"]
                    vals = db.table("rateios_valores").select("*").in_("rateio_id", r_ids).eq("ano", year).execute().data or []

            if vals:
                main_rateio_id = rateios[0]["id"]
                for i, m_item in enumerate(meses):
                    m = m_item['mes']
                    m_vals = [v for v in vals if int(v["month"]) == m]

                    c_val = sum(parse_valor(v["valor"]) for v in m_vals if v["rateio_id"] == main_rateio_id)
                    f_val = sum(parse_valor(v["valor"]) for v in m_vals if v["rateio_id"] != main_rateio_id)

                    meses[i]['condominio'] = c_val
                    meses[i]['fundo_reserva'] = f_val
                    meses[i]['total'] = c_val + f_val

                    total_condo += c_val
                    total_fundo += f_val
                    total_geral += (c_val + f_val)

        # Fallback: Arrecadacoes via Processos
        if total_geral == 0:
            try:
                arrec_res = db.table("arrecadacoes").select("*, processos!inner(condominio_id, year)") \
                    .eq("processos.condominio_id", condo_id).order("month").execute().data or []
                for r in arrec_res:
                    m = r.get('month')
                    if m and 1 <= m <= 12:
                        c_val = parse_valor(r.get('taxa_condominial'))
                        f_val = parse_valor(r.get('fundo_reserva'))
                        meses[m-1]['condominio'] = c_val
                        meses[m-1]['fundo_reserva'] = f_val
                        meses[m-1]['total'] = c_val + f_val
                        total_condo += c_val
                        total_fundo += f_val
                        total_geral += (c_val + f_val)
            except Exception as e2:
                print(f"[CONFERENCIA] Fallback arrecadacoes falhou: {e2}")

    except Exception as e:
        print(f"[CONFERENCIA] ERRO no espelhamento: {e}")
        traceback.print_exc()

    # Cobranças extras
    cobrancas = []
    try:
        extras_res = db.table("cobrancas_extras").select("*, processos!inner(condominio_id)") \
            .eq("processos.condominio_id", condo_id).execute().data or []
        for c in extras_res:
            cobrancas.append({
                'id': c.get('id'),
                'descricao': c.get('description') or 'Cobrança Extra',
                'mes': None, 'mes_nome': '—',
                'valor': parse_valor(c.get('amount')),
            })
    except:
        try:
            res_alt = db.table("cobrancas_extras").select("*").eq("condominio_id", condo_id).execute().data or []
            for c in res_alt:
                cobrancas.append({'id': c.get('id'), 'descricao': c.get('description') or 'Cobrança Extra', 'valor': parse_valor(c.get('amount'))})
        except: pass

    return {
        'planilha': {
            'ano': year,
            'meses': meses,
            'totais': {'condominio': total_condo, 'fundo_reserva': total_fundo, 'total': total_geral}
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
            if current_status == 'Enviado':
                update_payload['status'] = 'Em aprovação'
            elif current_status == 'Em aprovação':
                update_payload['status'] = 'Aprovado'
            else:
                update_payload['status'] = 'Aprovado'
            historico_action = 'Aprovado'

            # Assinatura digital
            if data.sign:
                content_hash = hashlib.sha256(
                    f"{processo_id}:{user['id']}:{datetime.utcnow().isoformat()}".encode()
                ).hexdigest()
                db.table("assinaturas").insert({
                    "processo_id": processo_id,
                    "signer_id": user['id'],
                    "signer_name": user.get('full_name') or user.get('email', 'Usuário'),
                    "signer_role": user.get('role'),
                    "signature_hash": content_hash,
                    "metadata": {"action": "approve"}
                }).execute()

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

        if role in ROLES_APROVADORES:
            # Quem aprova vê os aguardando sua ação
            query = query.in_("status", ["Enviado", "Em aprovação"])

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
        elif role in ['emissor', 'assistente']:
            # Emissor/assistente vê os que voltaram pra correção (emitidos por ele)
            query = query.eq("emitido_por", user['id']).eq("status", "Solicitar alteração")
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
        raise HTTPException(400, str(e))

```

## Arquivo: api/index.py
```python
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

```

## Arquivo: frontend/src/app/dashboard/page.js
```javascript
'use client';
import { useState } from 'react';
import useSWR from 'swr';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt, AlertCircle, Eye, ShieldCheck, MessageSquare, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';

export default function DashboardPage() {
  const [filtroGerente, setFiltroGerente] = useState('');
  const { user } = useAuth();
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [arquivoConferencia, setArquivoConferencia] = useState(null);

  // States de aprovação no Dashboard
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // ALTO FLUXO: SWR gerencia cache e revalidação automática
  const query = filtroGerente ? `?gerente_id=${filtroGerente}` : '';
  const { data, error, isLoading, mutate } = useSWR(`/api/dashboard${query}`, apiFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 5000
  });

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;

      let signedUrl = null;
      if (fileData) {
        const { data: urlData } = await supabase.storage
          .from('emissoes')
          .createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }

      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: fileData?.processo_id || null,
      });
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      
      addToast(action === 'approve' ? 'Processo aprovado!' : 'Correção solicitada!', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      
      mutate();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Erro de Conexão</h3>
        <p className="text-slate-400 mb-6">Não foi possível carregar os dados do painel.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-2 bg-slate-800 rounded-xl font-bold border border-slate-700">TENTAR NOVAMENTE</button>
      </div>
    );
  }

  // Extrair processos pendentes
  const stats = data?.stats || { total: 0, em_edicao: 0, pendentes: 0, aprovados: 0 };
  const condos = data?.condos || [];
  const gerentes = data?.gerentes || [];
  
  const pendingProcesses = [];
  if (data?.processos) {
      Object.keys(data.processos).forEach(condoId => {
          const proc = data.processos[condoId];
          const condo = condos.find(c => c.id === condoId);
          // Gerente e Master aprovam. Emissor só visualiza status de andamento.
          if (["Enviado", "Em aprovação"].includes(proc.status)) {
              pendingProcesses.push({ ...proc, condo });
          }
      });
  }

  return (
    <div className="animate-fade-in w-full h-full relative space-y-6 pb-20">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Condomínios" value={stats.total} icon={Building} color="cyan" loading={isLoading} />
        <StatsCard title="Em Edição" value={stats.em_edicao} icon={FileEdit} color="orange" loading={isLoading} />
        <StatsCard title="Pendentes" value={stats.pendentes} icon={Clock} color="indigo" loading={isLoading} />
        <StatsCard title="Aprovados" value={stats.aprovados} icon={CheckCircle2} color="emerald" loading={isLoading} />
      </div>

      {/* Painel Duplo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Tabela de Condomínios (Esquerda - 2/3) */}
        <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-md rounded-[2rem] border border-white/5 shadow-2xl overflow-hidden flex flex-col h-full">
          <div className="px-6 py-5 border-b border-white/5 flex flex-wrap items-center justify-between gap-4 bg-white/5">
            <div>
              <h3 className="text-lg font-black text-white leading-none">Informativo Semestral</h3>
              <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mt-1">
                PERÍODO: {data?.year || '—'} / {data?.semester === 1 ? '1º' : '2º'} SEMESTRE
              </p>
            </div>
            
            {user?.role !== 'gerente' && (
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Filtrar:</label>
                <select
                  value={filtroGerente}
                  onChange={(e) => setFiltroGerente(e.target.value)}
                  className="text-xs bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-slate-200 outline-none focus:border-cyan-500 transition-all cursor-pointer"
                >
                  <option value="">TODOS</option>
                  {gerentes.map((g) => (
                    <option key={g.id} value={g.id}>{g.profiles?.full_name || '—'}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="p-24 text-center">
              <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm font-bold text-slate-500 tracking-widest uppercase">Processando Dados...</p>
            </div>
          ) : condos.length > 0 ? (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white/5 border-b border-white/5 text-[10px] uppercase tracking-[0.2em] font-black text-slate-500">
                    <th className="px-6 py-4">Condomínio</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-white/5">
                  {condos.map((c) => {
                    const status = data?.processos?.[c.id]?.status || 'Sem processo';
                    
                    return (
                      <tr key={c.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                           <p className="font-bold text-gray-100 group-hover:text-cyan-400 transition-colors uppercase tracking-tight">{c.name}</p>
                           <p className="text-[10px] text-gray-500 font-medium">Dia {c.due_day} • {c.gerente_name || c.assistente || '—'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-6 py-4 text-right flex gap-2 justify-end">
                          <Link href={`/condominio/${c.id}/arrecadacoes`} className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-cyan-500/20" title="Arrecadações"><Layers className="w-4 h-4" /></Link>
                          <Link href={`/condominio/${c.id}/cobrancas`} className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-orange-500/20" title="Cobranças"><Receipt className="w-4 h-4" /></Link>
                          <button onClick={() => handleQuickView(c.id)} className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-violet-500/20" title="Ver Info"><Eye className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-20 text-center flex-1">
              <Inbox className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-300 font-bold">Nenhum condomínio encontrado</p>
            </div>
          )}
        </div>

        {/* Quadro Lateral Diretório de Pendências (Fila de Aprovação) */}
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-cyan-500/20 shadow-[0_0_40px_rgba(6,182,212,0.1)] overflow-hidden flex flex-col relative h-full">
           <div className="px-6 py-5 border-b border-cyan-500/20 bg-cyan-500/5">
              <div className="flex items-center gap-3">
                 <ShieldCheck className="w-5 h-5 text-cyan-400" />
                 <div>
                    <h3 className="text-lg font-black text-white leading-none tracking-tight">Fila de Conferência</h3>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">Pendentes de Ação</p>
                 </div>
              </div>
           </div>

           <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {isLoading ? (
                 <div className="py-20 text-center text-[10px] text-slate-500 font-black uppercase tracking-widest">Calculando pendências...</div>
              ) : pendingProcesses.length > 0 ? (
                 pendingProcesses.map(proc => (
                   <div key={proc.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-cyan-500/40 transition-colors shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                         <h4 className="text-sm font-black text-white uppercase tracking-tight truncate">{proc.condo?.name || '—'}</h4>
                         <span className="text-[9px] font-black uppercase bg-white/10 text-slate-300 px-2 py-1 rounded-md">{proc.status}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-4">
                         <button onClick={() => handleQuickView(proc.condominio_id)} className="p-2.5 bg-slate-800 hover:bg-cyan-500 text-slate-400 hover:text-slate-900 rounded-xl transition-all border border-transparent shadow" title="Visualizar Prévia"><Eye className="w-4 h-4" /></button>
                         <button 
                            disabled={processing === proc.id}
                            onClick={() => setShowRejectModal(proc)}
                            className="flex-1 py-2.5 bg-transparent hover:bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl text-[9px] font-black uppercase transition-all disabled:opacity-50"
                         >
                            Corrigir
                         </button>
                         <button 
                            disabled={processing === proc.id}
                            onClick={() => handleAction(proc.id, 'approve')}
                            className="flex-1 py-2.5 bg-cyan-500/10 hover:bg-cyan-500 text-cyan-500 hover:text-slate-950 border border-cyan-500/30 rounded-xl text-[9px] font-black uppercase transition-all shadow-lg shadow-cyan-500/10 disabled:opacity-50 flex justify-center items-center gap-1"
                         >
                            {processing === proc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Aprovar
                         </button>
                      </div>
                   </div>
                 ))
              ) : (
                 <div className="py-20 text-center">
                    <CheckCircle2 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Tudo limpo!</p>
                    <p className="text-[10px] text-slate-600 mt-1">Nenhuma pendência na fila.</p>
                 </div>
              )}
           </div>
        </div>

      </div>

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutate(); setArquivoConferencia(null); }}
        />
      )}

       {/* Reject Modal */}
       {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowRejectModal(null)}></div>
            <div className="glass-panel max-w-lg w-full p-10 rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-red-500/20 border border-red-500/30 rounded-2xl flex items-center justify-center">
                        <MessageSquare className="w-7 h-7 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Solicitar Ajuste</h3>
                        <p className="text-[10px] text-red-400 font-black uppercase tracking-widest mt-1">Devolução p/ Emissor</p>
                    </div>
                </div>
                
                <p className="text-slate-400 text-sm font-medium mb-6">
                    Descreva o motivo da devolução para <strong>{showRejectModal.condo?.name || 'o condomínio'}</strong>. Isso ajudará o emissor a realizar o conserto.
                </p>

                <textarea 
                    autoFocus
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl p-5 text-sm text-slate-200 focus:border-red-500 outline-none transition-all placeholder:text-slate-700 mb-8 shadow-inner"
                    placeholder="Ex: Valor da taxa condominial não condiz com a ata..."
                />

                <div className="flex gap-4">
                    <button onClick={() => setShowRejectModal(null)} className="flex-1 py-4 text-xs font-black text-slate-600 uppercase tracking-widest hover:text-white transition-colors">Cancelar</button>
                    <button 
                        disabled={!rejectReason || processing}
                        onClick={() => handleAction(showRejectModal.id, 'reject', rejectReason)}
                        className="flex-2 py-4 bg-red-500 hover:bg-red-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all shadow-2xl shadow-red-500/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                        {processing === showRejectModal.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} ENVIAR CORREÇÃO
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

```

## Arquivo: frontend/src/app/condominios/page.js
```javascript
'use client';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Building, PlusCircle, Pencil, Search, X, Loader2, User, Calendar, ShieldCheck, Eye } from 'lucide-react';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { createClient } from '@/utils/supabase/client';

export default function CondominiosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', due_day: '', gerente_id: '', assistente: '' });
  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const supabase = createClient();

  // SWR para Dados de Condomínios e Gerentes
  const { data: condosData, mutate: mutateCondos, isLoading: loadingCondos } = useSWR('/api/condominios', apiFetcher);
  const { data: usersData } = useSWR(user?.role === 'master' ? '/api/usuarios' : null, apiFetcher);

  const condos = condosData?.condos || [];
  const gerentes = (usersData?.usuarios || []).filter(u => u.role === 'gerente');

  const canEdit = user?.role === 'master';
  const filtered = condos.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  function openEdit(condo = null) {
    if (condo) {
      setFormData({ 
        id: condo.id, 
        name: condo.name, 
        due_day: condo.due_day || '', 
        gerente_id: condo.gerente_id || '', 
        assistente: condo.assistente || '' 
      });
    } else {
      setFormData({ id: '', name: '', due_day: '', gerente_id: '', assistente: '' });
    }
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await apiPost('/api/condominios/salvar', formData);
      addToast(formData.id ? 'Condomínio atualizado!' : 'Novo condomínio cadastrado!', 'success');
      setModalOpen(false);
      mutateCondos(); // Atualiza a lista instantaneamente
    } catch (err) {
      addToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;

      let signedUrl = null;
      if (fileData) {
        const { data: urlData } = await supabase.storage
          .from('emissoes')
          .createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }

      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: fileData?.processo_id || null,
      });
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  return (
    <div className="animate-fade-in w-full h-full relative space-y-8 pb-20">
      
      {/* Header com Busca e Ação */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 glass-panel p-8 rounded-[2rem] border-white/5 shadow-2xl">
        <div className="flex-1 w-full max-w-md relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
          <input 
            type="text" 
            placeholder="Pesquisar condomínio..." 
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 pl-12 pr-6 text-sm text-slate-200 outline-none focus:border-cyan-500/50 transition-all shadow-inner"
          />
        </div>

        {canEdit && (
          <button 
             onClick={() => openEdit()} 
             className="w-full md:w-auto bg-cyan-500 text-slate-950 px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400 shadow-xl shadow-cyan-500/20 active:scale-95 transition-all"
          >
            <PlusCircle className="w-5 h-5" /> NOVO CADASTRO
          </button>
        )}
      </div>

      {/* Grid de Condomínios */}
      {loadingCondos ? (
        <div className="p-24 text-center">
           <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
           <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Sincronizando Base...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(c => (
            <div key={c.id} className="glass-panel p-6 rounded-[2rem] border-white/5 hover:border-cyan-500/30 transition-all group shadow-xl flex flex-col justify-between">
                <div>
                   <div className="flex items-start justify-between mb-6">
                      <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform">
                         <Building className="w-6 h-6 text-slate-500 group-hover:text-cyan-400" />
                      </div>
                      {canEdit && (
                        <button onClick={() => openEdit(c)} className="p-3 bg-white/5 hover:bg-cyan-500/10 text-slate-500 hover:text-cyan-400 rounded-xl transition-all border border-transparent hover:border-cyan-500/20">
                           <Pencil className="w-4 h-4" />
                        </button>
                      )}
                   </div>
                   
                   <h3 className="text-xl font-black text-white uppercase tracking-tight mb-6 leading-tight group-hover:text-cyan-400 transition-colors">
                      {c.name}
                   </h3>
                   
                   <div className="space-y-3 mb-8">
                      <div className="flex items-center gap-3 text-slate-400">
                         <User className="w-4 h-4 text-violet-400" />
                         <span className="text-xs font-bold">{c.gerente_name || 'Gerente não definido'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                         <Calendar className="w-4 h-4 text-cyan-500" />
                         <span className="text-xs font-bold">Vencimento: Dia {c.due_day || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                         <ShieldCheck className="w-4 h-4 text-emerald-500" />
                         <span className="text-xs font-bold">Carteira: {c.assistente || 'Padrão'}</span>
                      </div>
                   </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-2">
                   <button onClick={() => handleQuickView(c.id)} className="p-3 bg-violet-500/10 hover:bg-violet-500 text-violet-400 hover:text-slate-950 rounded-xl transition-all border border-violet-500/20 shadow-lg shadow-violet-500/10" title="Visualizar Emissão"><Eye className="w-4 h-4" /></button>
                   <Link href={`/condominio/${c.id}/arrecadacoes`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Planilha</Link>
                   <Link href={`/condominio/${c.id}/cobrancas`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Extras</Link>
                </div>
            </div>
          ))}
        </div>
      )}

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutateCondos(); setArquivoConferencia(null); }}
        />
      )}

      {/* Modal de Cadastro/Edição */}
      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setModalOpen(false)}></div>
          <div className="glass-panel max-w-xl w-full rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                {formData.id ? 'Ajustar Cadastro' : 'Novo Condomínio'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Nome do condomínio</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                       className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Dia de Vencimento</label>
                  <input type="number" min="1" max="31" value={formData.due_day} onChange={e => setFormData({...formData, due_day: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Carteira / Assistente</label>
                  <input value={formData.assistente} onChange={e => setFormData({...formData, assistente: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Gerente Responsável</label>
                <select required value={formData.gerente_id} onChange={e => setFormData({...formData, gerente_id: e.target.value})}
                        className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner cursor-pointer">
                  <option value="">Selecione um gerente...</option>
                  {gerentes.map(g => (
                    <option key={g.id} value={g.id}>{g.full_name}</option>
                  ))}
                </select>
              </div>
              
              <div className="pt-6">
                <button type="submit" disabled={isSaving} className="w-full py-5 bg-cyan-500 text-slate-950 font-black rounded-2xl hover:bg-cyan-400 transition-all uppercase tracking-[0.2em] text-xs shadow-2xl shadow-cyan-500/20 flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  {formData.id ? 'SALVAR ALTERAÇÕES' : 'EFETIVAR CADASTRO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

```

## Arquivo: frontend/src/app/aprovacoes/page.js
```javascript
'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  CheckCircle2, AlertCircle, Clock, Search, 
  MessageSquare, Building2, 
  Loader2, Send, FileText, History, Inbox, Eye
} from 'lucide-react';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { createClient } from '@/utils/supabase/client';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';

export default function AprovacoesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const supabase = createClient();

  // SWR para Fila de Aprovações e Histórico
  const { data, error, isLoading, mutate } = useSWR('/api/aprovacoes', apiFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000 // 30s
  });

  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      
      addToast(action === 'approve' ? 'Processo aprovado com sucesso!' : 'Solicitação de correção enviada.', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      
      // Revalida os dados do SWR instantaneamente
      mutate();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;

      let signedUrl = null;
      if (fileData) {
        const { data: urlData } = await supabase.storage
          .from('emissoes')
          .createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }

      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: fileData?.processo_id || null,
      });
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  if (error) return (
    <div className="p-20 text-center glass-panel rounded-3xl">
      <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
      <p className="text-white font-bold">Erro ao carregar fila de aprovações</p>
    </div>
  );

  const pendentes = data?.pendentes || [];
  const historico = data?.historico || [];

  return (
    <div className="animate-fade-in space-y-8 pb-20">
      
      {/* Header Informativo */}
      <div className="glass-panel p-10 rounded-[2.5rem] border-white/5 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full -mr-48 -mt-48 blur-[100px]"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
                <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic">Central de Validação</h1>
                <p className="text-cyan-400/80 text-sm font-bold tracking-widest mt-2 uppercase">Fila de Aprovações — Alto Fluxo</p>
            </div>
            <div className="flex gap-4">
                <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl text-center shadow-inner">
                    <p className="text-2xl font-black text-white leading-none">{pendentes.length}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Pendentes</p>
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Coluna Principal: Lista de Pendentes */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Processos Aguardando Ação</h2>
          </div>

          {isLoading ? (
            <div className="p-24 text-center glass-panel rounded-[2rem]">
              <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">Sincronizando Fila...</p>
            </div>
          ) : pendentes.length === 0 ? (
            <div className="text-center py-24 glass-panel rounded-[2.5rem] border-dashed border-white/5">
                <CheckCircle2 className="w-16 h-16 text-slate-800 mx-auto mb-6" />
                <h3 className="text-xl font-black text-slate-400 uppercase tracking-tighter">Fila Vazia</h3>
                <p className="text-slate-600 text-sm font-medium">Todos os processos foram validados com sucesso.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendentes.map((item) => (
                <div key={item.id} className="glass-panel p-6 rounded-[2rem] border-white/5 group hover:border-cyan-500/30 transition-all flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden shadow-xl">
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-cyan-700/30 group-hover:bg-cyan-500 transition-colors"></div>
                    
                    <div className="flex items-center gap-6 flex-1">
                        <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center border border-white/5 shrink-0 group-hover:scale-105 transition-transform">
                            <Building2 className="w-7 h-7 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">{item.condominios?.name}</h3>
                                <StatusBadge status={item.status} />
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Comp: {item.year}/{item.semester === 1 ? '1º' : '2º'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => handleQuickView(item.condominio_id)}
                            className="p-3.5 bg-violet-500/10 hover:bg-violet-500 border border-violet-500/20 rounded-2xl text-violet-400 hover:text-slate-950 transition-all group/btn shadow-lg"
                            title="Visualizar Emissão"
                        >
                            <Eye className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                        </button>
                        
                        <Link 
                            href={`/condominio/${item.condominio_id}/arrecadacoes?ano=${item.year}`}
                            className="p-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-slate-400 hover:text-white transition-all group/btn shadow-lg"
                            title="Planilha"
                        >
                            <Search className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                        </Link>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => setShowRejectModal(item)}
                            className="px-6 py-3.5 bg-transparent hover:bg-red-500/10 text-red-500/70 hover:text-red-500 border border-red-500/10 hover:border-red-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 active:scale-95"
                        >
                            CORRIGIR
                        </button>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => handleAction(item.id, 'approve')}
                            className="px-8 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/20 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
                        >
                            {processing === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            APROVAR
                        </button>
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coluna Lateral: Histórico Recente */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <History className="w-5 h-5 text-violet-400" />
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Logs de Atividade</h2>
          </div>

          <div className="glass-panel rounded-[2rem] border-white/5 overflow-hidden">
             <div className="p-6 space-y-6">
                {isLoading ? (
                  <div className="py-10 text-center text-slate-700 font-bold text-[10px] uppercase tracking-widest">Sincronizando Histórico...</div>
                ) : historico.length === 0 ? (
                  <div className="py-10 text-center opacity-30">
                     <Inbox className="w-8 h-8 mx-auto mb-2" />
                     <p className="text-[10px] font-black uppercase">Sem registros</p>
                  </div>
                ) : (
                  historico.map((log) => (
                    <div key={log.id} className="relative pl-6 border-l border-white/5 pb-2 last:pb-0 group">
                        <div className={`absolute -left-[5px] top-0 w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.2)] 
                           ${log.action === 'Aprovado' ? 'bg-cyan-500 shadow-cyan-500/50' : 'bg-red-500 shadow-red-500/50'}`}></div>
                        <p className="text-[10px] font-black text-white/90 leading-tight uppercase tracking-tight">
                           {log.profiles?.full_name} {log.action.toLowerCase()} o condomínio {log.processos?.condominios?.name}
                        </p>
                        <p className="text-[9px] text-slate-500 font-bold mt-1">
                           {new Date(log.created_at).toLocaleString('pt-BR')}
                        </p>
                        {log.comment && (
                           <div className="mt-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl text-[11px] text-slate-400 italic">
                             &quot;{log.comment}&quot;
                           </div>
                        )}
                    </div>
                  ))
                )}
             </div>
          </div>
        </div>

      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowRejectModal(null)}></div>
            <div className="glass-panel max-w-lg w-full p-10 rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-red-500/20 border border-red-500/30 rounded-2xl flex items-center justify-center">
                        <MessageSquare className="w-7 h-7 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Solicitar Ajuste</h3>
                        <p className="text-[10px] text-red-400 font-black uppercase tracking-widest mt-1">Devolução p/ Emissor</p>
                    </div>
                </div>
                
                <p className="text-slate-400 text-sm font-medium mb-6">
                    Descreva o motivo da devolução para <strong>{showRejectModal.condominios?.name}</strong>. Isso ajudará o gerente a realizar o conserto.
                </p>

                <textarea 
                    autoFocus
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl p-5 text-sm text-slate-200 focus:border-red-500 outline-none transition-all placeholder:text-slate-700 mb-8 shadow-inner"
                    placeholder="Ex: Valor da taxa condominial não condiz com a ata..."
                />

                <div className="flex gap-4">
                    <button onClick={() => setShowRejectModal(null)} className="flex-1 py-4 text-xs font-black text-slate-600 uppercase tracking-widest hover:text-white transition-colors">Cancelar</button>
                    <button 
                        disabled={!rejectReason || processing}
                        onClick={() => handleAction(showRejectModal.id, 'reject', rejectReason)}
                        className="flex-2 py-4 bg-red-500 hover:bg-red-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all shadow-2xl shadow-red-500/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                        <Send className="w-4 h-4" /> ENVIAR CORREÇÃO
                    </button>
                </div>
            </div>
        </div>
      )}

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutate(); setArquivoConferencia(null); }}
        />
      )}
    </div>
  );
}

```

## Arquivo: frontend/src/components/VisualizadorConferencia.js
```javascript
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import {
  FileText, Building2, Receipt, Loader2, X, Check, AlertCircle,
  ExternalLink, PenTool
} from 'lucide-react';

/**
 * VisualizadorConferencia
 *
 * Mostra o PDF à esquerda + painel lateral com Planilha Anual e Cobranças Extras.
 * Botões de ação aparecem conforme o role do usuário.
 *
 * Props:
 * - arquivo: { id, nome, url, processo_id, condominio_id, emitido_por }
 * - currentUser: { id, role, full_name }
 * - onClose: callback para fechar o viewer
 * - onAction: callback chamado após aprovar/correção (refresh da lista)
 */
export default function VisualizadorConferencia({ arquivo, currentUser, onClose, onAction }) {
  const { addToast } = useToast();
  const supabase = createClient();

  const [planilha, setPlanilha] = useState(null);
  const [cobrancasExtras, setCobrancasExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modoCorrecao, setModoCorrecao] = useState(false);
  const [comentario, setComentario] = useState('');
  const [executando, setExecutando] = useState(false);

  // Capabilities do usuário
  const podeAprovar = can(currentUser?.role, 'approve_document');
  const podeAssinar = can(currentUser?.role, 'sign_document');

  // ─── Carrega planilha e cobranças extras ──────────────────────────
  useEffect(() => {
    async function carregar() {
      if (!arquivo?.condominio_id) return;
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch(`/api/condominio/${arquivo.condominio_id}/conferencia`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setPlanilha(data.planilha);
          setCobrancasExtras(data.cobrancas_extras || []);
        } else {
          addToast('Não foi possível carregar os dados da planilha.', 'error');
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [arquivo?.condominio_id, addToast, supabase]);

  // ─── Ações ────────────────────────────────────────────────────────
  async function handleAprovar() {
    if (!arquivo.processo_id) {
      addToast('Processo não vinculado a este arquivo.', 'error');
      return;
    }
    setExecutando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Aprova + assina em uma única chamada
      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'approve', comment: '', sign: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao aprovar');
      addToast('Documento aprovado e assinado!', 'success');
      onAction?.();
      onClose?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExecutando(false);
    }
  }

  async function handleSolicitarCorrecao() {
    if (!comentario.trim()) {
      addToast('Descreva o motivo da correção.', 'warning');
      return;
    }
    setExecutando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'reject', comment: comentario.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao solicitar correção');
      addToast('Correção solicitada. Documento retornado ao emissor.', 'success');
      onAction?.();
      onClose?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExecutando(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-bold truncate">{arquivo.nome || 'Documento'}</h3>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400">Visualização integrada</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {arquivo.url && (
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Abrir em nova aba">
              <ExternalLink className="w-5 h-5" />
            </a>
          )}
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-3 p-3 overflow-hidden">

        {/* ─── PDF à esquerda ─── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          {arquivo.url ? (
            <iframe
              src={arquivo.url}
              title={arquivo.nome}
              className="w-full h-full bg-white"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Documento sem URL disponível</p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Painel lateral direito ─── */}
        <div className="flex flex-col gap-3 overflow-y-auto">

          {/* Planilha Anual */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Planilha Anual</h4>
                  <p className="text-[10px] text-slate-500">Cadastrada pelo gerente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded">
                Só leitura
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : !planilha || planilha.meses?.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nenhuma planilha anual cadastrada para este condomínio.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950/30">
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Condomínio</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Fundo res.</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {planilha.meses.map((m) => (
                    <tr key={m.mes} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{m.mes_nome}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-300 font-mono">{formatCurrency(m.condominio)}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-300 font-mono">{formatCurrency(m.fundo_reserva)}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{formatCurrency(m.total)}</td>
                    </tr>
                  ))}
                  {planilha.totais && (
                    <tr className="border-t border-emerald-500/30 bg-emerald-500/10">
                      <td className="px-3 py-2 text-xs font-bold text-emerald-400 uppercase">Total</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.condominio)}</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.fundo_reserva)}</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.total)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Cobranças Extras — sempre visível */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Cobranças Extras</h4>
                  <p className="text-[10px] text-slate-500">Lançadas pelo gerente/assistente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                {cobrancasExtras.length} {cobrancasExtras.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              </div>
            ) : cobrancasExtras.length === 0 ? (
              <div className="p-6 text-center">
                <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                <p className="text-sm text-slate-500">Nenhuma cobrança extra lançada</p>
                <p className="text-xs text-slate-600 mt-1">Quando houver, aparecerão aqui para conferência.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950/30">
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Descrição</th>
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {cobrancasExtras.map((c) => (
                    <tr key={c.id} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-xs text-slate-300">{c.descricao}</td>
                      <td className="px-3 py-2 text-xs text-slate-400 uppercase">{c.mes_nome || c.mes}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{formatCurrency(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Footer com ações */}
      {podeAprovar && arquivo.processo_id && (
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900 shrink-0">
          {!modoCorrecao ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-slate-400">
                {podeAssinar && (
                  <span className="inline-flex items-center gap-1">
                    <PenTool className="w-3 h-3" />
                    Ao aprovar, você assina digitalmente com seu nome e timestamp.
                  </span>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setModoCorrecao(true)}
                  disabled={executando}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                  Solicitar correção
                </button>
                <button
                  onClick={handleAprovar}
                  disabled={executando}
                  className="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Aprovar e assinar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Motivo da correção <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                rows={3}
                placeholder="Ex: Valor do fundo de reserva em Março divergente da planilha anual..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 placeholder-slate-600 resize-none"
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setModoCorrecao(false); setComentario(''); }}
                  disabled={executando}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleSolicitarCorrecao}
                  disabled={executando || !comentario.trim()}
                  className="px-5 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors flex items-center gap-2 disabled:opacity-50">
                  {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                  Enviar correção ao emissor
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCurrency(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

```

## Arquivo: frontend/src/app/central-emissoes/page.js
```javascript
'use client';

import { useAuth } from '@/lib/auth';
import { Loader2 } from 'lucide-react';
import VisaoEmissor from './components/VisaoEmissor';
import VisaoGerente from './components/VisaoGerente';
import VisaoMaster from './components/VisaoMaster';

import { useState } from 'react';

export default function CentralEmissoesPage() {
  const { profile, loading } = useAuth();
  const [masterView, setMasterView] = useState('analytics'); // 'analytics' | 'upload'

  if (loading || !profile) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
      </div>
    );
  }

  const isMasterOrSup = ['master', 'supervisora', 'supervisor_gerentes', 'supervisora_contabilidade'].includes(profile.role);

  // Toolbar para Masters
  const masterToolbar = isMasterOrSup && (
    <div className="flex gap-4 mb-6 border-b border-white/5 pb-6">
      <button 
        onClick={() => setMasterView('analytics')}
        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${masterView === 'analytics' ? 'bg-cyan-500 text-slate-900 shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
      >
        Painel de Gestão
      </button>
      <button 
        onClick={() => setMasterView('upload')}
        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${masterView === 'upload' ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
      >
        Fazer Emissões
      </button>
    </div>
  );

  let content = null;

  // Se for departamento, ou um Master na aba de Upload, vê a tela de envo
  if (profile.role === 'departamento' || (isMasterOrSup && masterView === 'upload')) {
    content = <VisaoEmissor profile={profile} />;
  } 
  // Se for gerente, vê a tela de aprovações da sua carteira
  else if (profile.role === 'gerente') {
    content = <VisaoGerente profile={profile} />;
  } 
  // Master na visão Analytics
  else if (isMasterOrSup) {
    content = <VisaoMaster profile={profile} />;
  } 
  // Fallback de erro
  else {
    content = (
      <div className="p-12 text-center bg-white/5 rounded-3xl border border-white/10 max-w-2xl mx-auto mt-10 shadow-2xl">
        <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <div className="w-8 h-8 rounded-full bg-rose-500/50"></div>
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Acesso Restrito</h3>
        <p className="text-gray-400">Você não tem permissão para acessar o módulo Central de Emissões com o perfil atual ({profile.role}).</p>
      </div>
    );
  }

  return (
    <>
      {masterToolbar}
      {content}
    </>
  );
}

```

## Arquivo: frontend/src/app/central-emissoes/components/VisaoMaster.js
```javascript
'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Layers, CheckCircle, Clock, FileText, ExternalLink, Activity, Loader2, Trash2, Package, XCircle } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

export default function VisaoMaster() {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [confirmDeleteOrphanId, setConfirmDeleteOrphanId] = useState(null);

  const stats = {
    total: pacotes.length,
    gerente: pacotes.filter(p => p.status === 'Aguardando Gerente' || p.status === 'pendente').length,
    supervisor: pacotes.filter(p => p.status === 'Aguardando Supervisor' || p.status === 'Aguardando Chefe').length,
    aprovados: pacotes.filter(p => p.status === 'aprovado').length,
  };

  useEffect(() => {
    fetchPacotes();
    
    const channel = supabase.channel('master_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => { fetchPacotes(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPacotes() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name), profiles:uploaded_by(full_name)')
        .order('criado_em', { ascending: false });
      
      if (error) console.error("fetchPacotes erro:", error);
      
      if (data) {
        // Buscar contagem de arquivos por pacote separadamente
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .not('pacote_id', 'is', null);
        
        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        const enriched = data.map(p => ({ ...p, arquivos: arqMap[p.id] || [] }));
        setPacotes(enriched);

        // Buscar arquivos órfãos (sem pacote)
        const { data: orphanData } = await supabase
          .from('emissoes_arquivos')
          .select('*, condominios(name)')
          .is('pacote_id', null);
        
        setOrphans(orphanData || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleAprovar(id) {
    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: 'aprovado', atualizado_em: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      addToast('Erro na aprovação final', 'error');
    } else {
      addToast('Pacote Aprovado e Finalizado!', 'success');
      setIsDrawerOpen(false);
      fetchPacotes();
    }
  }

  async function handleRejeitar(pacote) {
    const reason = prompt("Motivo da correção:");
    if (!reason) return;
    await supabase.from('emissoes_pacotes').update({ 
      status: 'solicitar_correcao', 
      comentario_correcao: reason, 
      atualizado_em: new Date().toISOString() 
    }).eq('id', pacote.id);
    setIsDrawerOpen(false);
    fetchPacotes();
    addToast('Correção solicitada.', 'info');
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      addToast('Clique novamente para confirmar a exclusão', 'warning');
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      // Deletar arquivos do storage primeiro
      const pacote = pacotes.find(p => p.id === id);
      if (pacote?.arquivos?.length) {
        await supabase.storage.from('emissoes').remove(pacote.arquivos.map(a => a.arquivo_url));
      }
      // Deletar arquivos do banco
      await supabase.from('emissoes_arquivos').delete().eq('pacote_id', id);
      // Deletar o pacote
      const { error } = await supabase.from('emissoes_pacotes').delete().eq('id', id);
      if (error) throw error;
      setPacotes(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
      addToast('Pacote excluído com sucesso', 'success');
    } catch (err) {
      addToast('Falha: ' + err.message, 'error');
    }
  };

  const handleDeleteOrphan = async (e, arqId, path) => {
    e.stopPropagation();
    if (confirmDeleteOrphanId !== arqId) {
      setConfirmDeleteOrphanId(arqId);
      addToast('Clique novamente para excluir o arquivo legado', 'warning');
      setTimeout(() => setConfirmDeleteOrphanId(null), 3000);
      return;
    }
    try {
      if (path) await supabase.storage.from('emissoes').remove([path]);
      const { error } = await supabase.from('emissoes_arquivos').delete().eq('id', arqId);
      if (error) throw error;
      setOrphans(prev => prev.filter(o => o.id !== arqId));
      setConfirmDeleteOrphanId(null);
      addToast('Arquivo legado removido', 'success');
      fetchPacotes(); // Recarregar para garantir sincronia com badge
    } catch (err) {
      addToast('Falha: ' + err.message, 'error');
    }
  };

  async function openFileUrl(arq, pacote) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
    if (error) return addToast('Erro ao abrir arquivo.', 'error');
    
    if (data?.signedUrl) {
      setArquivoAberto({
        id: arq.id,
        nome: arq.arquivo_nome,
        url: data.signedUrl,
        processo_id: pacote.processo_id || null,
        condominio_id: pacote.condominio_id,
        emitido_por: pacote.uploaded_by
      });
    }
  }

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  return (
    <div className="space-y-8">
      
      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Pacotes', value: stats.total, icon: Layers, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Aguard. Gerente', value: stats.gerente, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Nível Supervisor', value: stats.supervisor, icon: Activity, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Finalizados', value: stats.aprovados, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
        ].map((stat, i) => (
          <div key={i} className={`p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex items-center gap-4 ${stat.bg}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mix-blend-lighten ${stat.bg} shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-3xl font-black text-white leading-none">{stat.value}</p>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela Master */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Activity className="text-cyan-400 w-5 h-5"/>
            Fluxo Geral — Pacotes de Emissão
          </h3>
        </div>

        <div className="divide-y divide-white/5">
          {pacotes.map(pacote => {
            const numArq = pacote.arquivos?.length || 0;
            const needsAction = pacote.status === 'Aguardando Supervisor' || pacote.status === 'Aguardando Gerente' || pacote.status === 'Aguardando Chefe' || pacote.status === 'pendente';

            return (
              <div key={pacote.id} className="hover:bg-white/[0.02] transition-colors">
                <div className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Package className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{pacote.condominios?.name}</p>
                      <p className="text-[10px] text-gray-500">
                        {String(pacote.mes_referencia).padStart(2,'0')}/{pacote.ano_referencia} • {numArq} arquivo{numArq !== 1 ? 's' : ''} • {pacote.profiles?.full_name}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <StatusBadge status={pacote.status} />
                    {needsAction && (
                      <div className="flex gap-1">
                        <button onClick={() => handleRejeitar(pacote)} className="p-2 rounded-lg bg-white/5 text-rose-400 hover:bg-rose-500/20 transition-all" title="Solicitar Correção">
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleAprovar(pacote.id)} className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-all" title="Aprovação Final">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button onClick={(e) => handleDelete(e, pacote.id)} className={`p-2 rounded-lg transition-all ${confirmDeleteId === pacote.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`} title={confirmDeleteId === pacote.id ? 'Clique para confirmar' : 'Excluir'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Arquivos inline */}
                {numArq > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2">
                    {pacote.arquivos.map(arq => (
                      <button
                        key={arq.id}
                        onClick={() => openFileUrl(arq, pacote)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0f] border border-white/10 rounded-lg hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group text-xs"
                      >
                        <FileText className="w-3 h-3 text-gray-500 group-hover:text-cyan-400" />
                        <span className="font-bold text-gray-400 group-hover:text-white truncate max-w-[120px]">{arq.arquivo_nome}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {pacotes.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              Nenhum pacote enviado para aprovação.
            </div>
          )}
        </div>
      </div>

      {/* Seção de Arquivos Órfãos (Legados ou Sem Pacote) */}
      {orphans.length > 0 && (
        <div className="border border-rose-500/20 rounded-3xl bg-rose-500/5 overflow-hidden shadow-xl">
          <div className="p-6 border-b border-rose-500/10 flex items-center justify-between">
            <h3 className="font-black text-white text-lg flex items-center gap-2">
              <FileText className="text-rose-400 w-5 h-5"/>
              Arquivos Órfãos / Legados
            </h3>
            <span className="text-[10px] font-bold text-rose-400/60 uppercase tracking-widest bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
              Estes arquivos estão gerando notificações mas não pertencem a pacotes
            </span>
          </div>

          <div className="divide-y divide-rose-500/5">
            {orphans.map(arq => (
              <div key={arq.id} className="px-6 py-4 flex items-center justify-between hover:bg-rose-500/[0.02] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">{arq.arquivo_nome}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {arq.condominios?.name || 'Condomínio não identificado'} • {new Date(arq.criado_em).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge status={arq.status} />
                  <button
                    onClick={() => openFileUrl(arq, { status: 'none' })}
                    className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white"
                    title="Visualizar"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteOrphan(e, arq.id, arq.arquivo_url)} 
                    className={`p-2 rounded-lg transition-all ${confirmDeleteOrphanId === arq.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`} 
                    title="Excluir Permanentemente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FilePreviewDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        file={selectedFile} 
      />

      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}
    </div>
  );
}

```

## Arquivo: frontend/src/lib/api.js
```javascript
import { createClient } from '@/utils/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Utilitário para obter headers de autenticação
 */
async function getAuthHeaders() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  return headers;
}

/**
 * Fetcher padrão para SWR
 */
export async function apiFetcher(url) {
  return apiFetch(url);
}

/**
 * Wrapper sobre fetch para chamadas à API FastAPI
 */
export async function apiFetch(path, opts = {}) {
  try {
    const headers = await getAuthHeaders();
    
    const response = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...headers, ...opts.headers },
    });
    
    if (!response.ok) {
      let errorMessage = 'Erro ao processar requisição na API';
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        errorMessage = await response.text() || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    return response.json();
  } catch (error) {
    console.error(`[API Error] ${path}:`, error.message);
    throw error;
  }
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

```

## Arquivo: frontend/src/lib/auth.js
```javascript
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase] = useState(() => createClient());

  async function fetchProfile(uid) {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      
      if (error) throw error;
      
      let gerenteId = null;
      if (profile.role === 'gerente') {
        const { data: gerente } = await supabase
          .from('gerentes')
          .select('id')
          .eq('profile_id', uid)
          .single();
        if (gerente) gerenteId = gerente.id;
      }
      
      setProfile({ ...profile, gerente_id: gerenteId });
    } catch (e) {
      console.error('Error fetching profile:', e);
    }
  }

  useEffect(() => {
    console.log('[Auth] Initializing session check...');
    let mounted = true;
    
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log('[Auth] getSession result:', { session, error });
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
      setLoading(false);
    }).catch(err => {
      console.error('[Auth] getSession fatal error:', err);
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        console.log('[Auth] onAuthStateChange event:', _event);
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          fetchProfile(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  // Merge profile data into user so user.role returns the app role ('master', 'gerente', etc.)
  const mergedUser = user && profile ? { ...user, role: profile.role, full_name: profile.full_name, profile_id: profile.id } : user;

  return (
    <AuthContext.Provider value={{ user: mergedUser, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

```

## Arquivo: schema.sql
```sql
-- Habilitar extensão para geração de UUIDs (necessário no PostgreSQL do Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. Limpar estruturas antigas para evitar conflitos de tipos já existentes
DROP TABLE IF EXISTS public.aprovacoes CASCADE;
DROP TABLE IF EXISTS public.cobrancas_extras CASCADE;
DROP TABLE IF EXISTS public.arrecadacoes CASCADE;
DROP TABLE IF EXISTS public.processos CASCADE;
DROP TABLE IF EXISTS public.condominios CASCADE;
DROP TABLE IF EXISTS public.gerentes CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS process_status CASCADE;

-- 1. Criação dos Enums para Tipos de Perfil e Status
CREATE TYPE user_role AS ENUM (
  'master',
  'departamento',
  'gerente',
  'supervisora',
  'sindico',
  'supervisor_gerentes',
  'supervisora_contabilidade',
  'outros'
);

CREATE TYPE process_status AS ENUM (
  'Em edição', 
  'Enviado', 
  'Em aprovação', 
  'Aprovado', 
  'Solicitar alteração', 
  'Emitido'
);

-- 2. Tabela de Perfis (Vinculada ao auth.users)
-- Centraliza o controle de acesso de todos os usuários do sistema.
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'outros',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 3. Tabela de Gerentes
-- Relacionamento 1:1 com profiles. Útil caso haja configurações específicas para o papel de gerente.
CREATE TABLE public.gerentes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  limit_condos INTEGER DEFAULT 35,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 4. Tabela de Condomínios (Cadastro Base)
CREATE TABLE public.condominios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  gerente_id UUID REFERENCES public.gerentes(id) ON DELETE SET NULL,
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  issue_limit_day INTEGER CHECK (issue_limit_day BETWEEN 1 AND 31),
  dispatch_limit_day INTEGER CHECK (dispatch_limit_day BETWEEN 1 AND 31),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 5. Tabela de Processos (Representa a planilha semestral)
CREATE TABLE public.processos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE NOT NULL,
  year INTEGER NOT NULL,
  semester INTEGER CHECK (semester IN (1, 2)) NOT NULL,
  status process_status DEFAULT 'Em edição',
  fluxo INTEGER, -- Opções 1, 2, 3 ou 4 dependendo da escolha no momento de envio
  current_approver_role user_role, -- Guarda qual papel deve aprovar agora a planilha (Ex: 'supervisora')
  issue_notes TEXT,
  manager_notes TEXT,
  manager_signature_date TIMESTAMPTZ,
  admin_signature_date TIMESTAMPTZ,
  vistos_datas_entrega TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(condominio_id, year, semester)
);

-- 6. Tabela de Arrecadações (Meses do Processo)
-- Apenas 1 registro por mês em um determinado processo semestral
CREATE TABLE public.arrecadacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  month INTEGER CHECK (month BETWEEN 1 AND 12),
  taxa_condominial NUMERIC(10,2) DEFAULT 0,
  fundo_reserva NUMERIC(10,2) DEFAULT 0,
  consumo_agua_gas TEXT, -- Pode ser valor numérico escrito em string ou especificamente "PLANILHA"
  outras_verbas JSONB DEFAULT '[]'::jsonb, -- Array json estruturado contendo {descricao: "string", valor: 0.00}
  UNIQUE(processo_id, month)
);

-- 7. Tabela de Cobranças Extras
CREATE TABLE public.cobrancas_extras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 8. Histórico de Aprovações/Alterações e Logs
-- Registra todas as ações e comentários tomados ao longo do fluxo do processo
CREATE TABLE public.aprovacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  approver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- Valores como: 'Enviado', 'Aprovado', 'Solicitado alteração', 'Emitido'
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- HABILITANDO SEGURANÇA EM NÍVEL DE LINHA (RLS - Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrecadacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes ENABLE ROW LEVEL SECURITY;


-- POLÍTICAS RLS (Row Level Security) BÁSICAS PARA DEMONSTRAÇÃO DO FLUXO:
-- (Obs: Em produção ou no momento de build, essas políticas podem ser mais finas)

-- 1. Profiles: Master vê e atualiza tudo. Todos os autenticados veem pelo menos os perfis.
CREATE POLICY "Master override all profiles" ON public.profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);
CREATE POLICY "View profiles by all authenticated" ON public.profiles FOR SELECT USING (
  auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles)
);

-- 2. Condominios: Master vê tudo. Gerente só vê os seus.
CREATE POLICY "Master ver todos condominios" ON public.condominios FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);
CREATE POLICY "Gerente vê seus condominios" ON public.condominios FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.gerentes g 
    WHERE public.condominios.gerente_id = g.id AND g.profile_id = auth.uid()
  )
);

-- 3. Processos (As regras base do desafio)
-- Master: Vê tudo e altera tudo.
CREATE POLICY "Master vê todos processos" ON public.processos FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);

-- Gerente: Só enxerga seus processos. E a política crítica: "Pode editar arrecadações/processos SOMENTE em status 'Em edição'"
CREATE POLICY "Gerente enxerga e edita os processos (limitado ao status pelo BD)" ON public.processos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = public.processos.condominio_id AND g.profile_id = auth.uid()
  )
);
CREATE POLICY "Gerente edita processo SÓ SE status for Em Edição" ON public.processos FOR UPDATE USING (
  status = 'Em edição' AND
  EXISTS (
    SELECT 1 FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = public.processos.condominio_id AND g.profile_id = auth.uid()
  )
);

-- 4. Arrecadacoes: Herdam o RLS do Processo vinculado.
CREATE POLICY "Gerentes podem ver suas arrecadacoes" ON public.arrecadacoes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.arrecadacoes.processo_id AND g.profile_id = auth.uid()
  )
);
-- Bloqueio pesado no banco de dados para Insert/Update nas arrecadações se não estiver "Em edição"
CREATE POLICY "Inserts/Updates/Deletes em arrecadacoes apenas se Processo Em edição" ON public.arrecadacoes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.arrecadacoes.processo_id AND g.profile_id = auth.uid() AND p.status = 'Em edição'
  )
);

-- 5. Cobrancas Extras: Acesso igual ao de arrecadações (travado ao envio).
CREATE POLICY "Gerentes podem ver cobrancas extras" ON public.cobrancas_extras FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.cobrancas_extras.processo_id AND g.profile_id = auth.uid()
  )
);
CREATE POLICY "Gerentes manipulam cobrancas extras somente Em Edição" ON public.cobrancas_extras FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.cobrancas_extras.processo_id AND g.profile_id = auth.uid() AND p.status = 'Em edição'
  )
);

```

