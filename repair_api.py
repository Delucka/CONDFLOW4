import sys
import os

path = r"c:\projetos\condominios\api\api_routes.py"
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if 'def api_usuarios_completo' in line:
        start_idx = i
        break

break_idx = -1
for i in range(start_idx, len(lines)):
    if 'result = []' in lines[i]:
        break_idx = i + 1
        break

resume_idx = -1
for i in range(break_idx, len(lines)):
    if '@router.post("/processo/{processo_id}/acao")' in lines[i]:
        resume_idx = i
        break

if break_idx == -1 or resume_idx == -1:
    print(f"Error: break_idx={break_idx}, resume_idx={resume_idx}")
    sys.exit(1)

middle_content = """    for p in profiles:
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
    \"\"\"Levanta 403 se o usuario nao tiver um dos roles permitidos.\"\"\"
    if user.get('role') not in roles:
        raise HTTPException(403, f"Acesso negado. Requer role: {', '.join(roles)}")


# ═══ Endpoint: Dados de conferência (Planilha + Cobranças) ════════════

@router.get("/condominio/{condo_id}/conferencia")
def api_dados_conferencia(condo_id: str, user: dict = Depends(get_current_user), db: Client = Depends(get_db)):
    \"\"\"
    Retorna dados de apoio para conferir um documento:
    - Planilha anual (arrecadacoes mes a mes)
    - Cobrancas extras lancadas para o condominio
    \"\"\"
    try:
        # 1) Arrecadacoes mes a mes (ano corrente)
        year = datetime.now().year
        
        rateios = db.table("rateios_config").select("id, nome").eq("condominio_id", condo_id).order("ordem").execute().data or []
        r_ids = [r["id"] for r in rateios]
        
        vals = []
        if r_ids:
            vals = db.table("rateios_valores").select("*").in_("rateio_id", r_ids).eq("ano", year).execute().data or []

        meses = []
        total_condo = 0
        total_fundo = 0
        total_geral = 0
        
        for mes in range(1, 13):
            condo_v = 0
            fundo_v = 0
            r_condo_id = rateios[0]["id"] if rateios else None
            
            has_val = False
            for v in vals:
                if int(v["month"]) == mes:
                    has_val = True
                    try:
                        val_float = float(str(v.get("valor", "0")).replace(".", "").replace(",", "."))
                    except ValueError:
                        val_float = 0
                        
                    if v["rateio_id"] == r_condo_id:
                        condo_v += val_float
                    else:
                        fundo_v += val_float
                        
            tot_v = condo_v + fundo_v
            
            if has_val:
                meses.append({
                    'mes': mes,
                    'mes_nome': MESES_PT.get(mes, str(mes)),
                    'condominio': condo_v,
                    'fundo_reserva': fundo_v,
                    'total': tot_v,
                })
                total_condo += condo_v
                total_fundo += fundo_v
                total_geral += tot_v

        # 2) Cobrancas extras (do ano corrente)
        extras_res = db.table("cobrancas_extras").select("id, description, amount, created_at").eq("condominio_id", condo_id).execute()

        cobrancas = []
        for c in (extras_res.data or []):
            try:
                dt_str = c.get("created_at", "").split(".")[0].replace("Z", "").replace("T", " ")
                dt = datetime.fromisoformat(dt_str)
                cb_year = dt.year
                cb_month = dt.month
            except:
                cb_year = year
                cb_month = 1
                
            if cb_year == year:
                try:
                    amt = float(str(c.get("amount", "0")).replace(".", "").replace(",", "."))
                except:
                    amt = 0
                cobrancas.append({
                    "id": c.get("id"),
                    "descricao": c.get("description", ""),
                    "mes": cb_month,
                    "mes_nome": MESES_PT.get(cb_month, str(cb_month)),
                    "valor": amt,
                })
        
        cobrancas = sorted(cobrancas, key=lambda x: x["mes"])

        return {
            'planilha': {
                'ano': year,
                'meses': meses,
                'totais': {
                    'condominio': total_condo,
                    'fundo_reserva': total_fundo,
                    'total': total_geral,
                }
            },
            'cobrancas_extras': cobrancas,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Erro ao carregar conferencia: {str(e)}")

class ApprovalActionV2(BaseModel):
    action: str              # 'approve' | 'reject'
    comment: Optional[str] = ""
    sign: Optional[bool] = False  # se True, registra assinatura digital
"""

final_lines = lines[:break_idx] + [middle_content] + lines[resume_idx:]

with open(path, "w", encoding="utf-8") as f:
    f.writelines(final_lines)

print("Repair completed successfully.")
