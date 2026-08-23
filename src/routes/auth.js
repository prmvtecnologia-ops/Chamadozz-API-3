const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'eduzz.com'

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '8h' })
}

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body
    if (!email || !senha) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' })

    const normalEmail = email.trim().toLowerCase()
    const domain = normalEmail.split('@')[1]
    if (domain !== ALLOWED_DOMAIN) {
      return res.status(403).json({ error: `Apenas e-mails @${ALLOWED_DOMAIN} são permitidos.` })
    }

    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [normalEmail])
    const user = rows[0]
    if (!user || !user.ativo) {
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo.' })
    }

    const ok = await bcrypt.compare(senha, user.senha_hash)
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' })

    // Atualiza último acesso
    await pool.query('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1', [user.id])

    const token = signToken(user.id)
    res.json({
      token,
      user: { id: user.id, email: user.email, nome: user.nome, role: user.role }
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /auth/me — valida token e retorna usuário atual
router.get('/me', requireAuth, (req, res) => {
  const { id, email, nome, role } = req.user
  res.json({ id, email, nome, role })
})

// POST /auth/trocar-senha
router.post('/trocar-senha', requireAuth, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body
    if (!senhaAtual || !novaSenha) return res.status(400).json({ error: 'Campos obrigatórios.' })
    if (novaSenha.length < 6) return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' })

    const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.user.id])
    const ok = await bcrypt.compare(senhaAtual, rows[0].senha_hash)
    if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' })

    const hash = await bcrypt.hash(novaSenha, 12)
    await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.user.id])
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
