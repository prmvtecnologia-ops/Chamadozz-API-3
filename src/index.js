require('dotenv').config()
const express = require('express')
const helmet  = require('helmet')
const cors    = require('cors')
const rateLimit = require('express-rate-limit')

const authRoutes     = require('./routes/auth')
const usuariosRoutes = require('./routes/usuarios')
const chamadosRoutes = require('./routes/chamados')

const app  = express()
const PORT = process.env.PORT || 3000

// ── Segurança ─────────────────────────────────────────────────────
app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '2mb' }))

// Rate limit geral
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }))

// Rate limit mais rígido no login
app.use('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } }))

// ── Rotas ─────────────────────────────────────────────────────────
app.use('/auth',      authRoutes)
app.use('/usuarios',  usuariosRoutes)
app.use('/chamados',  chamadosRoutes)

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// 404
app.use((_, res) => res.status(404).json({ error: 'Rota não encontrada.' }))

// Erro global
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno do servidor.' })
})

app.listen(PORT, () => {
  console.log(`🚀 API rodando na porta ${PORT}`)
  console.log(`   Domínio permitido: @${process.env.ALLOWED_DOMAIN || 'eduzz.com'}`)
  console.log(`   Frontend: ${process.env.FRONTEND_URL || '*'}`)
})
