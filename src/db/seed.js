require('dotenv').config()
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function seed() {
  const client = await pool.connect()
  try {
    const domain = (process.env.ALLOWED_DOMAIN || 'eduzz.com').split(',')[0].trim()
    const adminEmail = `admin@${domain}`
    const senhaHash = await bcrypt.hash('eduzz@2026', 12)

    const exists = await client.query('SELECT id FROM usuarios WHERE email = $1', [adminEmail])
    if (exists.rows.length) {
      console.log(`ℹ️  Admin ${adminEmail} já existe. Pulando seed.`)
    } else {
      await client.query(
        `INSERT INTO usuarios (email, nome, senha_hash, role) VALUES ($1, $2, $3, 'admin')`,
        [adminEmail, 'Administrador', senhaHash]
      )
      console.log(`✅ Admin criado: ${adminEmail} / senha: eduzz@2026`)
      console.log('⚠️  Troque a senha no primeiro acesso!')
    }
  } catch (e) {
    console.error('❌ Erro no seed:', e.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
