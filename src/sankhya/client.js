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

function buildMetaParams(tipo, meta) {
  const e = (v) => esc(v)
  switch (tipo) {
    case 'Viagem': return `
      UPDATE AD_CHAMADO SET
        VGORIGEM  = '${e(meta.origem)}',
        VGDESTINO = '${e(meta.destino)}',
        VGMODAL   = '${e(meta.modal)}',
        VGHOTEL   = '${e(meta.hotel_rede)}'
      WHERE IDCHAMADO = '`
    case 'Reembolso': return `
      UPDATE AD_CHAMADO SET
        RBPERIODO = '${e(meta.periodo)}',
        RBTITULAR = '${e(meta.titular)}',
        RBCPF     = '${e(meta.cpf)}',
        RBBANCO   = '${e(meta.banco)}',
        RBAGENCIA = '${e(meta.agencia)}',
        RBCONTA   = '${e(meta.conta)}',
        RBPIX     = '${e(meta.pix)}'
      WHERE IDCHAMADO = '`
    case 'Pagamento': return `
      UPDATE AD_CHAMADO SET
        PGFORNECEDOR = '${e(meta.fornecedor)}',
        PGCNPJ       = '${e(meta.cnpj)}',
        PGFORMA      = '${e(meta.forma_pagamento)}'
      WHERE IDCHAMADO = '`
    case 'LinhaTeléfonica': return `
      UPDATE AD_CHAMADO SET
        LTTIPO      = '${e(meta.tipo_linha)}',
        LTOPERADORA = '${e(meta.operadora)}',
        LTUSUARIO   = '${e(meta.usuario_linha)}'
      WHERE IDCHAMADO = '`
    case 'Contrato': return `
      UPDATE AD_CHAMADO SET
        CTCONTRAPARTE = '${e(meta.contraparte)}',
        CTTIPO        = '${e(meta.tipo_contrato)}',
        CTURGENCIA    = '${e(meta.urgencia)}',
        CTLINKDOC     = '${e(meta.link_doc)}'
      WHERE IDCHAMADO = '`
    default: return null
  }
}

async function criarChamado(chamado) {
  const hoje = fmtDate()
  const meta = chamado.metadados || {}

  console.log('[Sankhya] Tentando INSERT via procedure para', chamado.id)

  const sql = `
    BEGIN
      PRC_INSERT_AD_CHAMADO(
        '${esc(chamado.id)}',
        '${esc(chamado.tipo)}',
        '${esc(chamado.titulo)}',
        '${esc(chamado.status || 'aguardando')}',
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
      );
    END;
  `

  console.log('[Sankhya] SQL procedure:', sql)

  const result = await sankhyaRequest('DbExplorerSP.executeQuery', { sql })

  // Se tem campos de tipo específico, faz UPDATE
  const metaSql = buildMetaParams(chamado.tipo, meta)
  if (metaSql) {
    const updateSql = `BEGIN ${metaSql}${esc(chamado.id)}'; END;`
    console.log('[Sankhya] SQL update meta:', updateSql)
    await sankhyaRequest('DbExplorerSP.executeQuery', { sql: updateSql })
  }

  return result
}

async function atualizarStatus(nuseq, id, status) {
  const hoje = fmtDate()
  const sql = `
    BEGIN
      UPDATE AD_CHAMADO
      SET STATUS = '${esc(status)}',
          DTATUALIZACAO = TO_DATE('${hoje}', 'DD/MM/YYYY')
      WHERE NUSEQ = ${Number(nuseq)};
      COMMIT;
    END;
  `
  console.log('[Sankhya] SQL atualizarStatus:', sql)
  return sankhyaRequest('DbExplorerSP.executeQuery', { sql })
}

async function buscarNuseq(idChamado) {
  const data = await sankhyaRequest('DbExplorerSP.executeQuery', {
    sql: `SELECT NUSEQ FROM AD_CHAMADO WHERE IDCHAMADO = '${esc(idChamado)}'`,
  })

  const rows = data?.responseBody?.rows
  if (rows && rows.length && rows[0].length) return Number(rows[0][0])

  const entities = data?.responseBody?.entities?.entity
  if (entities) {
    const row = Array.isArray(entities) ? entities[0] : entities
    return Number(row?.f0?.$) || null
  }

  return null
}

module.exports = { criarChamado, atualizarStatus, buscarNuseq }
