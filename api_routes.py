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

# ═══ API ENDPOINTS ═══════════════════════════════════════════════════

@router.get("/dashboard")
def api_dashboard(gerente_id: Optional[str] = None, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    from datetime import datetime
    year = datetime.now().year
    sem = 1 if datetime.now().month <= 6 else 2

    query = db.table("condominios").select("*, processos(*)")
    
    # Filtros baseados na role
    if user["role"] == "gerente":
        query = query.eq("gerente_id", user["id"])
    elif gerente_id and user["role"] in ["master", "supervisora", "supervisora_contabilidade"]:
        query = query.eq("gerente_id", gerente_id)
        
    raw_condos = query.execute().data
    
    # Processa os dados
    condos = []
    processos = {}
    stats = {"total": len(raw_condos), "em_edicao": 0, "pendentes": 0, "aprovados": 0}
    
    for c in raw_condos:
        # Pega o processo do semestre atual
        procs = c.pop("processos", [])
        proc = next((p for p in procs if p["year"] == year and p["semester"] == sem), None)
        if proc:
            processos[c["id"]] = proc
            st = proc["status"]
            if st in ["Em edição", "Solicitar alteração"]: stats["em_edicao"] += 1
            elif st in ["Enviado", "Em aprovação"]: stats["pendentes"] += 1
            elif st in ["Aprovado", "Emitido"]: stats["aprovados"] += 1
        else:
            stats["em_edicao"] += 1 # Sem processo = em edição por default
            
        condos.append(c)
        
    # Busca gerentes para o filtro dropdown
    gerentes = []
    if user["role"] != "gerente":
        gerentes = db.table("gerentes").select("id, profiles(full_name)").execute().data

    return {
        "year": year, 
        "semester": sem, 
        "stats": stats, 
        "condos": condos,
        "processos": processos,
        "gerentes": gerentes
    }

@router.get("/condominios")
def api_condominios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(status_code=403, detail="Apenas master")
    condos = db.table("condominios").select("*").order("name").execute().data
    return {"condos": condos}

class CondoData(BaseModel):
    id: Optional[str] = None
    name: str
    due_day: str
    gerente_id: str
    assistente: str

@router.post("/condominios/salvar")
def api_salvar_condominio(data: CondoData, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403, "Apenas master")
    
    payload = {"name": data.name, "due_day": data.due_day, "gerente_id": data.gerente_id, "assistente": data.assistente}
    
    if data.id:
        db.table("condominios").update(payload).eq("id", data.id).execute()
    else:
        db.table("condominios").insert(payload).execute()
        
    return {"success": True}

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

@router.get("/condominio/{condo_id}/arrecadacoes")
def api_get_arrecadacoes(condo_id: str, ano: int, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
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

@router.get("/usuarios")
def api_usuarios(user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    if user["role"] != "master":
        raise HTTPException(403)
    usuarios = db.table("profiles").select("*").execute().data
    return {"usuarios": usuarios}
