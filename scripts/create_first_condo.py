import os
import sys
from dotenv import load_dotenv
from supabase import create_client

def main():
    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("✕  Erro: SUPABASE_URL ou SUPABASE_KEY não encontradas no .env")
        return
    
    sb = create_client(url, key)

    print("\n--- Criando Primeiro Condomínio (Baseado na Imagem) ---")
    
    # 1. Tenta encontrar o gerente RODRIGO CAVALCANTE
    print("Buscando gerente Rodrigo Cavalcante...")
    try:
        res = sb.table("profiles").select("id").ilike("full_name", "%Rodrigo%").execute()
    except Exception as e:
        print(f"  ✕ Erro ao buscar perfis: {e}")
        return

    rodrigo_profile_id = None
    gerente_id = None
    if res.data:
        rodrigo_profile_id = res.data[0]["id"]
        print(f"  ✓ Perfil encontrado: {rodrigo_profile_id}")
    else:
        print("  ! Perfil de Rodrigo Cavalcante não encontrado.")
        print("  Tentando buscar qualquer gerente existente no sistema...")
        try:
            res_g = sb.table("gerentes").select("id, profiles(full_name)").limit(1).execute()
            if res_g.data:
                gerente_id = res_g.data[0]["id"]
                nome_gerente = res_g.data[0].get("profiles", {}).get("full_name", "Gerente")
                print(f"  ✓ Usando gerente existente: {nome_gerente} (ID: {gerente_id})")
            else:
                print("  ✕ Nenhum gerente encontrado no sistema.")
                print("  Por favor, crie um gerente primeiro via /admin/usuarios.")
                return
        except Exception as e:
            print(f"  ✕ Erro ao buscar gerentes: {e}")
            return

    # Se encontramos o perfil do Rodrigo mas não sabemos se ele é gerente na tabela 'gerentes'
    if rodrigo_profile_id:
        try:
            res_g = sb.table("gerentes").select("id").eq("profile_id", rodrigo_profile_id).execute()
            if res_g.data:
                gerente_id = res_g.data[0]["id"]
                print(f"  ✓ Rodrigo já é um gerente (ID: {gerente_id})")
            else:
                print("  ! Rodrigo encontrado como perfil, mas não é um gerente. Criando na tabela gerentes...")
                res_ins = sb.table("gerentes").insert({"profile_id": rodrigo_profile_id, "limit_condos": 50}).execute()
                if res_ins.data:
                    gerente_id = res_ins.data[0]["id"]
                    print(f"  ✓ Rodrigo agora é gerente (ID: {gerente_id})")
                else:
                    print("  ✕ Erro ao criar gerente para Rodrigo.")
                    return
        except Exception as e:
            print(f"  ✕ Erro ao verificar/criar gerente: {e}")
            return

    # 2. Inserir o Condomínio (Upsert pelo nome)
    condo_data = {
        "name": "242 PERSONA VERGUEIRO",
        "due_day": 10,
        "gerente_id": gerente_id,
        "limit_gerencia": 5,
        "limit_emissao": 10,
        "limit_expedicao": 15,
        "obs_emissao": "DIFERENÇA ENTRE O VALOR DA CONTA DE ÁGUA E O VALOR RATEADO É POR CONTA DO METODO UTILIZADO (SABESP)"
    }

    print(f"Inserindo condomínio {condo_data['name']}...")
    try:
        # Primeiro verificamos se já existe para evitar erros de duplicidade ou atualizar corretamente
        res_check = sb.table("condominios").select("id").eq("name", condo_data["name"]).execute()
        if res_check.data:
            cid = res_check.data[0]["id"]
            sb.table("condominios").update(condo_data).eq("id", cid).execute()
            print(f"  ✓ Condomínio atualizado com sucesso (ID: {cid})")
            condo_id = cid
        else:
            res_ins = sb.table("condominios").insert(condo_data).execute()
            if res_ins.data:
                condo_id = res_ins.data[0]["id"]
                print(f"  ✓ Condomínio criado com sucesso (ID: {condo_id})")
            else:
                print("  ✕ Erro ao inserir condomínio.")
                return
    except Exception as e:
        print(f"  ✕ Erro ao salvar condomínio: {e}")
        return

    # 3. Criar Processo Inicial e Arrecadações (dados da imagem)
    # Valores: 75247.88 para condomínio e 3762.39 para fundo de reserva
    print("Criando processo inicial 2026/1...")
    proc_data = {
        "condominio_id": condo_id,
        "year": 2026,
        "semester": 1,
        "status": "Em edição"
    }
    try:
        # Verifica se já existe processo
        res_p = sb.table("processos").select("id").eq("condominio_id", condo_id).eq("year", 2026).eq("semester", 1).execute()
        if res_p.data:
            proc_id = res_p.data[0]["id"]
            print(f"  ✓ Processo já existente (ID: {proc_id})")
        else:
            res_ins_p = sb.table("processos").insert(proc_data).execute()
            if res_ins_p.data:
                proc_id = res_ins_p.data[0]["id"]
                print(f"  ✓ Processo criado (ID: {proc_id})")
            else:
                print("  ✕ Erro ao criar processo.")
                return

        # Inserir arrecadações para Janeiro a Maio de 2026
        print("Atualizando arrecadações mensais (Jan-Mai)...")
        for mes in range(1, 6):
            arr_row = {
                "processo_id": proc_id,
                "month": mes,
                "taxa_condominial": 75247.88,
                "fundo_reserva": 3762.39,
                "consumo_agua_gas": "PLANILHA"
            }
            sb.table("arrecadacoes").upsert(arr_row, on_conflict="processo_id,month").execute()
        print("  ✓ Arrecadações inseridas com sucesso.")
    except Exception as e:
        print(f"  ! Aviso: Problema ao criar processo/arrecadações: {e}")

    print("\n═══════════════════════════════════════")
    print("  ✓ Finalizado com Exito!")
    print("  Condomínio: 242 PERSONA VERGUEIRO")
    print("  Gerente ID: " + str(gerente_id))
    print("═══════════════════════════════════════\n")

if __name__ == "__main__":
    main()
