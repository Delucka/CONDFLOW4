import os
import uuid
import httpx
from dotenv import load_dotenv

load_dotenv()
URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

gerentes_list = [
    {"nome": "Suellen", "assistente": "Leonardo", "email": "suellen@condoadmin.com"},
    {"nome": "Eduardo", "assistente": "Fabiana", "email": "eduardo@condoadmin.com"},
    {"nome": "Rodrigo", "assistente": "Danilo", "email": "rodrigo@condoadmin.com"},
    {"nome": "Natalia", "assistente": "Gabriel", "email": "natalia@condoadmin.com"},
    {"nome": "Patricia", "assistente": "Vitor", "email": "patricia@condoadmin.com"},
    {"nome": "Mauro Jr", "assistente": "Iago", "email": "maurojr@condoadmin.com"},
    {"nome": "Marlei", "assistente": "Silvia", "email": "marlei@condoadmin.com"},
    {"nome": "Aline", "assistente": "Jenifer", "email": "aline@condoadmin.com"},
    {"nome": "Diogo", "assistente": "Fernando", "email": "diogo@condoadmin.com"}
]

print("Inserindo/Verificando gerentes e assistentes...")

with httpx.Client(timeout=15) as client:
    for g in gerentes_list:
        # Check profile
        r = client.get(f"{URL}/rest/v1/profiles?email=eq.{g['email']}", headers=headers)
        data = r.json()
        
        if not data:
            uid = str(uuid.uuid4())
            p_res = client.post(
                f"{URL}/rest/v1/profiles",
                headers=headers,
                json={"id": uid, "email": g['email'], "full_name": g['nome'], "role": "gerente"}
            )
            pid = uid
            print(f"Criado profile: {g['nome']}")
        else:
            pid = data[0]["id"]
            client.patch(
                f"{URL}/rest/v1/profiles?id=eq.{pid}",
                headers=headers,
                json={"full_name": g['nome'], "role": "gerente"}
            )
            print(f"Atualizado profile: {g['nome']}")
            
        # Check gerente
        g_req = client.get(f"{URL}/rest/v1/gerentes?profile_id=eq.{pid}", headers=headers)
        g_data = g_req.json()
        
        if not g_data:
            client.post(
                f"{URL}/rest/v1/gerentes",
                headers=headers,
                json={"profile_id": pid, "assistente": g['assistente']}
            )
            print(f"   -> Inserido na tabela gerentes (Assist: {g['assistente']})")
        else:
            client.patch(
                f"{URL}/rest/v1/gerentes?profile_id=eq.{pid}",
                headers=headers,
                json={"assistente": g['assistente']}
            )
            print(f"   -> Atualizado na tabela gerentes (Assist: {g['assistente']})")

print("\nTodos os gerentes foram processados com sucesso!")
