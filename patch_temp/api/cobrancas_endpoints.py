# ═══════════════════════════════════════════════════════════════
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
            })

        db.table("cobrancas_extras").insert(registros).execute()
        return {"success": True, "grupo_id": grupo_id, "parcelas_criadas": len(registros)}
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
            .neq("status", "cancelada") \
            .order("ano").order("mes")

        if mes and ano:
            query = query.eq("mes", mes).eq("ano", ano)

        res = query.execute()
        return {"cobrancas": res.data or []}
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
