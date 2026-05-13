import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, Request # type: ignore
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
            gerentes = db.table("gerentes").select("id, profiles!gerentes_profile_id_fkey(full_name)").execute().data

        # ── Emissões: stats agregados + status mais recente por condomínio ──
        condo_ids = [c["id"] for c in raw_condos]
        emissao_stats = {"gerente": 0, "supGerente": 0, "supContabilidade": 0, "aguardando": 0, "registrada": 0}
        emissao_by_condo = {}
        if condo_ids:
            pacotes_q = db.table("emissoes_pacotes").select("status, condominio_id, criado_em") \
                .in_("condominio_id", condo_ids) \
                .order("criado_em", desc=True)
            pacotes = pacotes_q.execute().data or []
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

        # ── Pipeline config do ano corrente ──
        pipeline_res = db.table("pipeline_config").select("*").eq("ano", year).limit(1).execute()
        pipeline_config = (pipeline_res.data or [None])[0]

        return {
            "year": year,
            "semester": sem,
            "stats": stats,
            "condos": condos,
            "processos": processos,
            "gerentes": gerentes,
            "emissao_stats": emissao_stats,
            "emissao_by_condo": emissao_by_condo,
            "pipeline_config": pipeline_config,
        }
    except Exception as e:
        print(f"ERROR /dashboard: {e}")
        raise HTTPException(500, str(e))

@router.get("/condominios")
def api_condominios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        # Puxa os condomínios (sem join complexo para evitar travamentos)
        query = db.table("condominios").select("*").order("name")
        
        if user["role"] == "gerente":
            g_id = get_gerente_id(db, user["id"])
            if g_id:
                query = query.eq("gerente_id", g_id)
            else:
                query = query.eq("gerente_id", "00000000-0000-0000-0000-000000000000")
                
        condos = query.execute().data or []
        
        # Mapeamento de nomes de gerentes de forma estável
        try:
            # Puxa todos os gerentes e profiles para o De-para (leitura rápida)
            gerentes_res = db.table("gerentes").select("id, profile_id").execute().data or []
            profiles_res = db.table("profiles").select("id, full_name").execute().data or []
            
            p_map = {p["id"]: p["full_name"] for p in profiles_res}
            g_map = {g["id"]: p_map.get(g["profile_id"], "Gerente desconhecido") for g in gerentes_res}
            
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
    gerente_id: str
    assistente: str
    fluxo: int = 1

@router.post("/condominios/salvar")
def api_salvar_condominio(data: CondoData, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    try:
        if user["role"] != "master":
            raise HTTPException(403, "Apenas master")
        
        payload = {"name": data.name, "due_day": data.due_day, "gerente_id": data.gerente_id, "assistente": data.assistente, "fluxo": data.fluxo}
        
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

        # 2. Criar ou Atualizar no Profiles
        db.table("profiles").upsert({
            "id": uid,
            "email": data.email,
            "full_name": data.full_name,
            "role": data.role
        }).execute()

        # 3. Se for gerente, garantir entrada na tabela de gerentes
        if data.role == 'gerente':
            db.table("gerentes").upsert({"profile_id": uid}, on_conflict="profile_id").execute()

        return {"success": True, "uid": uid}
        
    except Exception as e:
        print(f"CRITICAL ERROR CREATE_USER: {e}")
        raise HTTPException(status_code=400, detail=str(e))

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
def api_dados_conferencia(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
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
        # Busca o mês/ano do processo/pacote para filtrar as cobranças
        # Se não houver pacote ainda, tenta pegar do contexto ou mostra as ativas
        mes_ref = None
        ano_ref = year
        
        proc_res = db.table("processos").select("year, semester").eq("id", condo_id).execute() # Simplificado
        
        query = db.table("cobrancas_extras").select("id,description,amount,created_at,attachments,status,mes,ano") \
            .eq("condominio_id", condo_id) \
            .neq("status", "cancelada")
            
        # Tenta descobrir o mês que estamos conferindo (pode vir de um parâmetro futuro)
        # Por enquanto, se houver mes/ano na query da URL, usamos.
        req_mes = request.query_params.get("mes")
        req_ano = request.query_params.get("ano")
        
        if req_mes and req_ano:
            query = query.eq("mes", int(req_mes)).eq("ano", int(req_ano))
        
        extras = query.order("created_at", desc=True).execute().data or []
        
        for c in extras:
            # Se for uma conferência normal, só mostra as 'ativa'
            # Se for retificação (podemos detectar via flag), mostramos as 'processada' também
            is_retif = request.query_params.get("retificacao") == "true"
            
            if not is_retif and c.get("status") == "processada":
                continue

            atts = c.get('attachments') or []
            signed_atts = []
            for a in atts:
                try:
                    res = db.storage.from_("emissoes").create_signed_url(a, 3600)
                    signed_atts.append(res.get('signedURL', a) if isinstance(res, dict) else a)
                except:
                    signed_atts.append(a)
            cobrancas.append({'id':c.get('id'),'descricao':c.get('description') or 'Cobrança Extra','mes':None,'mes_nome':'—','valor':parse_valor(c.get('amount')),'attachments':signed_atts})
    except:
        try:
            procs = db.table("processos").select("id").eq("condominio_id", condo_id).execute().data or []
            pids  = [p["id"] for p in procs]
            if pids:
                for c in (db.table("cobrancas_extras").select("id,description,amount,attachments").in_("processo_id", pids).neq("status", "cancelada").order("created_at", desc=True).order("parcela_atual").execute().data or []):
                    atts = c.get('attachments') or []
                    signed_atts = []
                    for a in atts:
                        try:
                            res = db.storage.from_("emissoes").create_signed_url(a, 3600)
                            signed_atts.append(res.get('signedURL', a) if isinstance(res, dict) else a)
                        except:
                            signed_atts.append(a)
                    cobrancas.append({'id':c.get('id'),'descricao':c.get('description') or 'Cobrança Extra','mes':None,'mes_nome':'—','valor':parse_valor(c.get('amount')),'attachments':signed_atts})
        except: pass

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
