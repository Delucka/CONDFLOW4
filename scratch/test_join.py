import os
from supabase import create_client

SB_URL = os.getenv("SUPABASE_URL", "https://jlypmnpkvvlyrxyvlyyl.supabase.co")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY", "")

db = create_client(SB_URL, SB_SERVICE)

try:
    print("Testing condominios join query...")
    # Tentando o join que pode estar falhando
    res = db.table("condominios").select("*, gerentes(profiles(full_name))").limit(5).execute()
    print("Success!")
    print(res.data)
except Exception as e:
    print(f"Error: {e}")
