-- Tabela cobrancas_extras (caso não exista)
CREATE TABLE IF NOT EXISTS cobrancas_extras (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    condominio_id UUID NOT NULL REFERENCES condominios(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Acesso via service key (sem RLS)
ALTER TABLE cobrancas_extras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_cobrancas" ON cobrancas_extras FOR ALL USING (true) WITH CHECK (true);
