const router  = require('express').Router()
const pool    = require('../db/pool')
const sankhya = require('../sankhya')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const SANKHYA_ON = () => !!(
  process.env.SANKHYA_APP_KEY &&
  process.env.SANKHYA_TOKEN   &&
  process.env.SANKHYA_USER    &&
  process.env.SANKHYA_PASS
)

function genId() {
  const d  = new Date()
  const dt = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  return `CHM-${dt}-${Math.floor(1000 + Math.random() * 8999)}`
}

// GET /chamados
router.get('/', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const { rows } = isAdmin
      ? await pool.query('SELECT * FROM chamados ORDER BY criado_em DESC')
      : await pool.query('SELECT * FROM chamados WHERE autor_email = $1 ORDER BY criado_em DESC', [req.user.email])
    res.json(rows)
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /chamados/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM chamados WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' })
    const c = rows[0]
    if (req.user.role !== 'admin' && c.autor_email !== req.user.email)
      return res.status(403).json({ error: 'Acesso negado.' })
    const { rows: hist } = await pool.query(
      'SELECT * FROM historico_chamados WHERE chamado_id = $1 ORDER BY criado_em ASC', [req.params.id]
    )
    res.json({ ...c, historico: hist })
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /chamados
router.post('/', requireAuth, async (req, res) => {
  try {
    const { tipo, titulo, valor, solicitante, email, aprovador, centro_custo, obs, metadados } = req.body
    if (!tipo || !titulo || !valor || !solicitante || !email)
      return res.status(400).json({ error: 'Campos obrigatórios: tipo, titulo, valor, solicitante, email.' })

    const id = genId()

    const { rows } = await pool.query(
      `INSERT INTO chamados
         (id, tipo, titulo, valor, solicitante, email, aprovador, centro_custo, obs,
          metadados, autor_email, autor_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, tipo, titulo, Number(valor), solicitante, email,
       aprovador || null, centro_custo || null, obs || null,
       JSON.stringify(metadados || {}), req.user.email, req.user.nome]
    )

    await pool.query(
      `INSERT INTO historico_chamados (chamado_id, status_para, usuario_email, usuario_nome)
       VALUES ($1, 'aguardando', $2, $3)`,
      [id, req.user.email, req.user.nome]
    )

    const chamado = rows[0]

    if (SANKHYA_ON()) {
      sankhya.criarChamado({ ...chamado, metadados: metadados || {} })
        .then(() => {
          pool.query('UPDATE chamados SET sankhya = true WHERE id = $1', [id])
          console.log(`[Sankhya] ✓ Chamado ${id} gravado na AD_CHAMADO`)
        })
        .catch(err => console.error(`[Sankhya] ✗ Erro ao gravar ${id}:`, err.message))
    }

    res.status(201).json(chamado)
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erro interno.' })
  }
})

// PATCH /chamados/:id/status
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body
    if (!['aguardando','aprovado','fila','rejeitado'].includes(status))
      return res.status(400).json({ error: 'Status inválido.' })

    const { rows: cur } = await pool.query('SELECT * FROM chamados WHERE id = $1', [req.params.id])
    if (!cur.length) return res.status(404).json({ error: 'Não encontrado.' })

    const { rows } = await pool.query(
      'UPDATE chamados SET status = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    )

    await pool.query(
      `INSERT INTO historico_chamados (chamado_id, status_de, status_para, usuario_email, usuario_nome)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, cur[0].status, status, req.user.email, req.user.nome]
    )

    if (SANKHYA_ON()) {
      sankhya.buscarNuseq(req.params.id)
        .then(nuseq => {
          if (nuseq) return sankhya.atualizarStatus(nuseq, req.params.id, status)
          console.warn(`[Sankhya] NUSEQ não encontrado para ${req.params.id}`)
        })
        .then(() => console.log(`[Sankhya] ✓ Status ${req.params.id} → ${status}`))
        .catch(err => console.error(`[Sankhya] ✗ Erro ao atualizar status:`, err.message))
    }

    res.json(rows[0])
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erro interno.' })
  }
})

// DELETE /chamados/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM chamados WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /chamados/:id/sync-sankhya
router.post('/:id/sync-sankhya', requireAuth, requireAdmin, async (req, res) => {
  if (!SANKHYA_ON()) return res.status(400).json({ error: 'Sankhya não configurado.' })
  try {
    const { rows } = await pool.query('SELECT * FROM chamados WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' })
    const c = rows[0]
    await sankhya.criarChamado({ ...c, metadados: c.metadados || {} })
    await pool.query('UPDATE chamados SET sankhya = true WHERE id = $1', [req.params.id])
    res.json({ ok: true, message: 'Chamado sincronizado com Sankhya.' })
  } catch (e) {
    res.status(500).json({ error: 'Erro ao sincronizar: ' + e.message })
  }
})

module.exports = router
