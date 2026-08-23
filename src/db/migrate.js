require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id          SERIAL PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        nome        TEXT NOT NULL,
        senha_hash  TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        ativo       BOOLEAN NOT NULL DEFAULT true,
        criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ultimo_acesso TIMESTAMPTZ
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS chamados (
        id            TEXT PRIMARY KEY,
        tipo          TEXT NOT NULL,
        titulo        TEXT NOT NULL,
        valor         NUMERIC(12,2) NOT NULL,
        status        TEXT NOT NULL DEFAULT 'aguardando'
                        CHECK (status IN ('aguardando','aprovado','fila','rejeitado')),
        autor_email   TEXT NOT NULL REFERENCES usuarios(email),
        autor_nome    TEXT NOT NULL,
        solicitante   TEXT NOT NULL,
        email         TEXT NOT NULL,
        aprovador     TEXT,
        centro_custo  TEXT,
        obs           TEXT,
        sankhya       BOOLEAN NOT NULL DEFAULT false,
        metadados     JSONB NOT NULL DEFAULT '{}',
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS historico_chamados (
        id          SERIAL PRIMARY KEY,
        chamado_id  TEXT NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
        status_de   TEXT,
        status_para TEXT NOT NULL,
        usuario_email TEXT NOT NULL,
        usuario_nome  TEXT NOT NULL,
        criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      )
    `)

    // Índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chamados_autor ON chamados(autor_email)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_historico_chamado ON historico_chamados(chamado_id)`)

    await client.query('COMMIT')
    console.log('✅ Migrations executadas com sucesso.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ Erro na migration:', e.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
