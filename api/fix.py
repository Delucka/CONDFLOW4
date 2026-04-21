import re

with open("api_routes.py", "r", encoding="utf-8") as f:
    content = f.read()

new_logic = '''        # 1) Arrecadações mês a mês (ano corrente)
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

        # 2) Cobranças extras (do ano corrente)
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

        return {'''

pattern = r'        # 1\) Arrecadações.*?(?=        return \{)'

res = re.sub(pattern, new_logic, content, flags=re.DOTALL)

with open("api_routes.py", "w", encoding="utf-8") as f:
    f.write(res)
print("Done")
