/**
 * src/sankhya.js
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

function buildMetaCampos(tipo, meta) {
  const p = (v, max = 98) => String(v || '').substring(0, max)
  switch (tipo) {
    case 'Viagem': return {
      VGORIGEM:  { $: p(meta.origem) },
      VGDESTINO: { $: p(meta.destino) },
      VGMODAL:   { $: p(meta.modal) },
      VGHOTEL:   { $: p(meta.hotel_rede) },
    }
    case 'Reembolso': return {
      RBPERIODO:  { $: p(meta.periodo) },
      RBTITULAR:  { $: p(meta.titular) },
      RBCPF:      { $: p(meta.cpf) },
      RBBANCO:    { $: p(meta.banco) },
      RBAGENCIA:  { $: p(meta.agencia) },
      RBCONTA:    { $: p(meta.conta) },
      RBPIX:      { $: p(meta.pix) },
    }
    case 'Pagamento': return {
      PGFORNECEDOR: { $: p(meta.fornecedor) },
      PGCNPJ:       { $: p(meta.cnpj) },
      PGFORMA:      { $: p(meta.forma_pagamento) },
    }
    case 'LinhaTeléfonica': return {
      LTTIPO:      { $: p(meta.tipo_linha) },
      LTOPERADORA: { $: p(meta.operadora) },
      LTUSUARIO:   { $: p(meta.usuario_linha) },
    }
    case 'Contrato': return {
      CTCONTRAPARTE: { $: p(meta.contraparte) },
      CTTIPO:        { $: p(meta.tipo_contrato) },
      CTURGENCIA:    { $: p(meta.urgencia) },
      CTLINKDOC:     { $: p(meta.link_doc) },
    }
    default: return {}
  }
}

async function criarChamado(chamado) {
  const p = (v, max = 98) => String(v || '').substring(0, max)
  const hoje = fmtDate()
  const meta = chamado.metadados || {}

  console.log('[Sankhya] Tentando saveRecord para', chamado.id)

  const localFields = {
    IDCHAMADO:    { $: p(chamado.id, 98) },
    TIPO:         { $: p(chamado.tipo, 98) },
    TITULO:       { $: p(chamado.titulo, 98) },
    STATUS:       { $: p(chamado.status || 'aguardando', 98) },
    VALOR:        { $: Number(chamado.valor || 0) },
    SOLICITANTE:  { $: p(chamado.solicitante, 98) },
    EMAILSOLICIT: { $: p(chamado.email, 98) },
    AUTOREMAIL:   { $: p(chamado.autor_email, 98) },
    AUTORNOME:    { $: p(chamado.autor_nome, 98) },
    APROVADOR:    { $: p(chamado.aprovador, 98) },
    CENTROCUSTO:  { $: p(chamado.centro_custo, 98) },
    OBS:          { $: p(chamado.obs, 98) },
    DTABERTURA:   { $: hoje },
    SYNKOK:       { $: 'S' },
    ...buildMetaCampos(chamado.tipo, meta),
  }

  console.log('[Sankhya] Payload localFields:', JSON.stringify(localFields, null, 2))

  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: { localFields },
    },
  })
}

async function atualizarStatus(nuseq, id, status) {
  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: {
          NUSEQ:         { $: Number(nuseq) },
          STATUS:        { $: String(status) },
          DTATUALIZACAO: { $: fmtDate() },
        },
      },
    },
  })
}

async function buscarNuseq(idChamado) {
  const data = await sankhyaRequest('CRUDServiceProvider.loadRecords', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      offsetPage: '0',
      criteria: {
        expression: { $: `this.IDCHAMADO = '${idChamado.replace(/'/g, "''")}'` },
      },
      fieldSet: { list: 'NUSEQ' },
    },
  })

  const rows = data?.responseBody?.entities?.entity
  if (!rows) return null
  const row = Array.isArray(rows) ? rows[0] : rows
  return row?.f0?.$ || null
}

module.exports = { criarChamado, atualizarStatus, buscarNuseq }
