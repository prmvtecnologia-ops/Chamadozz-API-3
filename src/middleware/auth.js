const jwt = require('jsonwebtoken')
const pool = require('../db/pool')

async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido.' })
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    // Busca usuário atualizado do banco (garante que ativo/role estão atuais)
    const { rows } = await pool.query(
      'SELECT id, email, nome, role, ativo FROM usuarios WHERE id = $1',
      [payload.sub]
    )
    if (!rows.length || !rows[0].ativo) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' })
    }
    req.user = rows[0]
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' })
  }
  next()
}

module.exports = { requireAuth, requireAdmin }
