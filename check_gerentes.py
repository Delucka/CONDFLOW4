import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY"))

ger_res = sb.table("gerentes").select("id, profile_id, profiles(full_name, email)").execute().data
print("=== GERENTES ===")
for g in ger_res:
    print(f"Gerente {g['id']} -> {g.get('profiles', {}).get('full_name')} ({g.get('profiles', {}).get('email')})")

condo_res = sb.table("condominios").select("id, name, gerente_id").execute().data
print("\n=== CONDOMINIOS (GERENTE ID) ===")
# count frequency of gerente_id
freq = {}
for c in condo_res:
    gid = c['gerente_id']
    freq[gid] = freq.get(gid, 0) + 1

for gid, count in freq.items():
    print(f"Gerente_id {gid}: {count} condominios")
