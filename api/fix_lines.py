import sys

with open("api_routes.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

new_logic = """    try:
        # 1) Arrecadacoes mes a mes (ano corrente)
        from datetime import datetime
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
                dt_str = c.get("created_at", "").split(".")[0].replace("Z", "")
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
"""

# Find start and end indices
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "def api_dados_conferencia" in line:
        start_idx = i
    if start_idx != -1 and i > start_idx + 8 and "return {" in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    # Retain the def and docstring
    # The actual logic try: block starts some lines after docstring
    # Let's just find "try:" after start_idx
    try_idx = -1
    for i in range(start_idx, end_idx):
        if "try:" in lines[i]:
            try_idx = i
            break
            
    if try_idx != -1:
        new_lines = lines[:try_idx] + [new_logic] + lines[end_idx+1:]
        with open("api_routes.py", "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        print("Success")
    else:
        print("try block not found")
else:
    print("Function boundaries not found")
