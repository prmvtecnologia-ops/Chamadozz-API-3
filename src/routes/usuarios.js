const router = require('express').Router()
const bcrypt = require('bcryptjs')
const pool = require('../db/pool')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'eduzz.com'

// GET /usuarios — lista todos (admin)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, nome, role, ativo, criado_em, ultimo_acesso FROM usuarios ORDER BY nome'
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /usuarios — cria usuário (admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, nome, senha, role = 'user' } = req.body
    if (!email || !nome || !senha) return res.status(400).json({ error: 'email, nome e senha são obrigatórios.' })
    if (senha.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' })

    const domain = email.trim().toLowerCase().split('@')[1]
    if (domain !== ALLOWED_DOMAIN) return res.status(400).json({ error: `Apenas @${ALLOWED_DOMAIN}.` })
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role inválido.' })

    const hash = await bcrypt.hash(senha, 12)
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, nome, senha_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, nome, role, ativo, criado_em`,
      [email.trim().toLowerCase(), nome.trim(), hash, role]
    )
    res.status(201).json(rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado.' })
    console.error(e)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// PATCH /usuarios/:id/role — promove/rebaixa (admin)
router.patch('/:id/role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role inválido.' })
    if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ error: 'Você não pode alterar seu próprio role.' })

    const { rows } = await pool.query(
      'UPDATE usuarios SET role = $1 WHERE id = $2 RETURNING id, email, nome, role, ativo',
      [role, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' })
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// PATCH /usuarios/:id/ativo — ativa/desativa (admin)
router.patch('/:id/ativo', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ error: 'Você não pode desativar sua própria conta.' })
    const { rows: cur } = await pool.query('SELECT ativo FROM usuarios WHERE id = $1', [req.params.id])
    if (!cur.length) return res.status(404).json({ error: 'Usuário não encontrado.' })

    const { rows } = await pool.query(
      'UPDATE usuarios SET ativo = $1 WHERE id = $2 RETURNING id, email, nome, role, ativo',
      [!cur[0].ativo, req.params.id]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
