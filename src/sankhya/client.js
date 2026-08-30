/**
 * src/sankhya/client.js
 */

const BASE_URL = process.env.SANKHYA_BASE_URL || 'http://eduzz.snk.ativy.com:40020'
const APP_KEY  = process.env.SANKHYA_APP_KEY
const TOKEN    = process.env.SANKHYA_TOKEN
const USERNAME = process.env.SANKHYA_USER
const PASSWORD = process.env.SANKHYA_PASS

let cachedJWT    = null
let jwtExpiresAt = 0

function fmtDate() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

async function getJWT() {
  if (cachedJWT && Date.now() < jwtExpiresAt) return cachedJWT

  const res = await fetch(`${BASE_URL}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'MobileLoginSP.login',
      requestBody: {
        NOMUSU:        { $: USERNAME },
        INTERNO:       { $: PASSWORD },
        KEEPCONNECTED: { $: 'S' },
      },
    }),
  })

  const data = await res.json()
  let jwt = data?.responseBody?.jsessionid?.$
  if (!jwt) {
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const match = setCookie.match(/JSESSIONID=([^;]+)/)
      if (match) jwt = match[1]
    }
  }
  if (!jwt) throw new Error('Sankhya: JWT nao encontrado: ' + JSON.stringify(data).substring(0, 300))

  cachedJWT    = jwt
  jwtExpiresAt = Date.now() + 25 * 60 * 1000
  console.log('[Sankhya] Login OK, JWT obtido')
  return jwt
}

async function sankhyaRequest(serviceName, requestBody) {
  const jwt = await getJWT()
  console.log(`[Sankhya] Chamando ${serviceName}...`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  let res
  try {
    res = await fetch(`${BASE_URL}/mge/service.sbr?serviceName=${serviceName}&outputType=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `JSESSIONID=${jwt}`,
      },
      body: JSON.stringify({ serviceName, requestBody }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const text = await res.text()
  console.log(`[Sankhya] Resposta ${serviceName} (${res.status}):`, text)

  let data
  try { data = JSON.parse(text) } catch(e) {
    throw new Error(`Sankhya resposta inválida: ${text.substring(0, 200)}`)
  }

  if (data?.status === '0' || data?.status === '1' || data?.responseBody) return data

  const errMsg = JSON.stringify(data?.statusMessage || data?.error || data)
  throw new Error(`Sankhya [${serviceName}] erro: ${errMsg}`)
}

function esc(v, max = 98) {
  return String(v || '').replace(/'/g, "''").substring(0, max)
}

async function execSelect(sql) {
  return sankhyaRequest('DbExplorerSP.executeQuery', { sql })
}

async function criarChamado(chamado) {
  const hoje = fmtDate()
  const meta = chamado.metadados || {}

  console.log('[Sankhya] Tentando INSERT via FNC para', chamado.id)

  const sql = `
    SELECT FNC_INSERT_AD_CHAMADO(
      '${esc(chamado.id)}',
      '${esc(chamado.tipo)}',
      '${esc(chamado.titulo)}',
      '${esc(chamado.status || "aguardando")}',
      ${Number(chamado.valor || 0)},
      '${esc(chamado.solicitante)}',
      '${esc(chamado.email)}',
      '${esc(chamado.autor_email)}',
      '${esc(chamado.autor_nome)}',
      '${esc(chamado.aprovador)}',
      '${esc(chamado.centro_custo)}',
      '${esc(chamado.obs)}',
      TO_DATE('${hoje}', 'DD/MM/YYYY'),
      'S'
    ) FROM DUAL
  `

  console.log('[Sankhya] SQL INSERT:', sql)
  const result = await execSelect(sql)

  const rows = result?.responseBody?.rows
  if (rows && rows[0] && rows[0][0] === -1) {
    throw new Error('Sankhya: FNC_INSERT_AD_CHAMADO retornou erro')
  }

  // Atualiza campos de tipo específico
  const tipo = chamado.tipo
  if (['Viagem','Reembolso','Pagamento','LinhaTeléfonica','Contrato'].includes(tipo)) {
    const metaSql = `
      SELECT FNC_UPDATE_AD_CHAMADO_META(
        '${esc(chamado.id)}',
        '${esc(tipo)}',
        '${esc(meta.origem)}',
        '${esc(meta.destino)}',
        '${esc(meta.modal)}',
        '${esc(meta.hotel_rede)}',
        '${esc(meta.periodo)}',
        '${esc(meta.titular)}',
        '${esc(meta.cpf)}',
        '${esc(meta.banco)}',
        '${esc(meta.agencia)}',
        '${esc(meta.conta)}',
        '${esc(meta.pix)}',
        '${esc(meta.fornecedor)}',
        '${esc(meta.cnpj)}',
        '${esc(meta.forma_pagamento)}',
        '${esc(meta.tipo_linha)}',
        '${esc(meta.operadora)}',
        '${esc(meta.usuario_linha)}',
        '${esc(meta.contraparte)}',
        '${esc(meta.tipo_contrato)}',
        '${esc(meta.urgencia)}',
        '${esc(meta.link_doc)}'
      ) FROM DUAL
    `
    console.log('[Sankhya] SQL META:', metaSql)
    await execSelect(metaSql)
  }

  return result
}

async function atualizarStatus(nuseq, id, status) {
  const hoje = fmtDate()
  const sql = `
    SELECT FNC_UPDATE_AD_CHAMADO_STATUS(
      ${Number(nuseq)},
      '${esc(status)}',
      TO_DATE('${hoje}', 'DD/MM/YYYY')
    ) FROM DUAL
  `
  console.log('[Sankhya] SQL STATUS:', sql)
  return execSelect(sql)
}

async function buscarNuseq(idChamado) {
  const data = await execSelect(
    `SELECT NUSEQ FROM AD_CHAMADO WHERE IDCHAMADO = '${esc(idChamado)}'`
  )

  const rows = data?.responseBody?.rows
  if (rows && rows.length && rows[0].length) return Number(rows[0][0])
  return null
}

module.exports = { criarChamado, atualizarStatus, buscarNuseq }
