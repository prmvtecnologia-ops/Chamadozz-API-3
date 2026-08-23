/**
 * sankhya/client.js
 * Integração com Sankhya On-Premise (MGE)
 * Host: eduzz.snk.ativy.com:40020
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

// ── Autenticação MGE ──────────────────────────────────────────────
async function getJWT() {
  if (cachedJWT && Date.now() < jwtExpiresAt) return cachedJWT

  const res = await fetch(`${BASE_URL}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'MobileLoginSP.login',
      requestBody: {
        NOMUSU: { $: USERNAME },
        INTERNO: { $: PASSWORD },
        KEEPCONNECTED: { $: 'S' },
      },
    }),
  })

  const data = await res.json()
  let jwt = data?.responseBody?.jsessionid?.$
  if (!jwt) {
    const setCookie = res.headers.get('set-cookie')
    console.log('[Sankhya] Login body:', JSON.stringify(data).substring(0, 300))
    console.log('[Sankhya] set-cookie:', setCookie?.substring(0, 150))
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

// ── Requisição genérica ───────────────────────────────────────────
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
  console.log(`[Sankhya] Resposta ${serviceName} (${res.status}):`, text.substring(0, 500))

  let data
  try { data = JSON.parse(text) } catch(e) { throw new Error(`Sankhya resposta inválida: ${text.substring(0,200)}`) }

  if (data?.status === '1' || data?.responseBody) return data
  const errMsg = JSON.stringify(data?.statusMessage || data?.error || data)
  throw new Error(`Sankhya [${serviceName}] erro: ${errMsg}`)
}

// ── Criar registro na AD_CHAMADO ──────────────────────────────────
async function criarChamado(chamado) {
  const meta = chamado.metadados || {}
  const hoje = fmtDate()

  const fields = [
    { name: 'NUSEQ',        $: '0' },
    { name: 'IDCHAMADO',    $: String(chamado.id || '') },
    { name: 'TIPO',         $: String(chamado.tipo || '') },
    { name: 'TITULO',       $: String(chamado.titulo || '').substring(0, 98) },
    { name: 'STATUS',       $: String(chamado.status || 'aguardando') },
    { name: 'VALOR',        $: String(Number(chamado.valor || 0).toFixed(2)) },
    { name: 'SOLICITANTE',  $: String(chamado.solicitante || '').substring(0, 98) },
    { name: 'EMAILSOLICIT', $: String(chamado.email || '').substring(0, 98) },
    { name: 'AUTOREMAIL',   $: String(chamado.autor_email || '').substring(0, 98) },
    { name: 'AUTORNOME',    $: String(chamado.autor_nome || '').substring(0, 98) },
    { name: 'APROVADOR',    $: String(chamado.aprovador    || '').substring(0, 98) },
    { name: 'CENTROCUSTO',  $: String(chamado.centro_custo || '').substring(0, 98) },
    { name: 'OBS',          $: String(chamado.obs          || '').substring(0, 998) },
    { name: 'DTABERTURA',   $: hoje },
    { name: 'DTATUALIZACAO',$: hoje },
    { name: 'SYNKOK',       $: 'S' },
    ...buildMetaCampos(chamado.tipo, meta),
  ]

  const filteredFields = fields.filter(f => f.$ !== '' && f.name !== 'NUSEQ')

  console.log('[Sankhya] criarChamado campos:', filteredFields.map(f => f.name).join(', '))

  // Monta objeto de campos para o CRUD
  const fieldObj = {}
  filteredFields.forEach(f => { fieldObj[f.name] = { $: f.$ } })

  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: {
          field: filteredFields
        },
      },
      entity: {
        fieldset: {
          list: filteredFields.map(f => f.name).join(',')
        }
      }
    },
  })
}

// ── Atualizar status na AD_CHAMADO ────────────────────────────────
async function atualizarStatus(nuseq, id, status) {
  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: {
          field: [
            { name: 'NUSEQ',         $: String(nuseq) },
            { name: 'STATUS',        $: String(status) },
            { name: 'DTATUALIZACAO', $: fmtDate() },
          ],
        },
      },
    },
  })
}

// ── Buscar NUSEQ pelo IDCHAMADO ───────────────────────────────────
async function buscarNuseq(idChamado) {
  const data = await sankhyaRequest('CRUDServiceProvider.loadRecords', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      offsetPage: '0',
      criteria: {
        expression: { $: `this.IDCHAMADO = '${idChamado}'` },
      },
      fieldSet: { list: 'NUSEQ' },
    },
  })

  const rows = data?.responseBody?.entities?.entity
  if (!rows) return null
  const row = Array.isArray(rows) ? rows[0] : rows
  return row?.f0?.$ || null
}

// ── Campos por tipo ───────────────────────────────────────────────
function buildMetaCampos(tipo, meta) {
  switch (tipo) {
    case 'Viagem': return [
      { name: 'VGORIGEM',    $: meta.origem      || '' },
      { name: 'VGDESTINO',   $: meta.destino     || '' },
      { name: 'VGMODAL',     $: meta.modal       || '' },
      { name: 'VGHOTEL',     $: meta.hotel_rede  || '' },
    ]
    case 'Reembolso': return [
      { name: 'RBPERIODO',   $: meta.periodo  || '' },
      { name: 'RBTITULAR',   $: meta.titular  || '' },
      { name: 'RBCPF',       $: meta.cpf      || '' },
      { name: 'RBBANCO',     $: meta.banco    || '' },
      { name: 'RBAGENCIA',   $: meta.agencia  || '' },
      { name: 'RBCONTA',     $: meta.conta    || '' },
      { name: 'RBPIX',       $: meta.pix      || '' },
    ]
    case 'Pagamento': return [
      { name: 'PGFORNECEDOR',$: meta.fornecedor      || '' },
      { name: 'PGCNPJ',      $: meta.cnpj            || '' },
      { name: 'PGFORMA',     $: meta.forma_pagamento || '' },
    ]
    case 'LinhaTeléfonica': return [
      { name: 'LTTIPO',      $: meta.tipo_linha    || '' },
      { name: 'LTOPERADORA', $: meta.operadora     || '' },
      { name: 'LTUSUARIO',   $: meta.usuario_linha || '' },
    ]
    case 'Contrato': return [
      { name: 'CTCONTRAPARTE',$: meta.contraparte   || '' },
      { name: 'CTTIPO',       $: meta.tipo_contrato || '' },
      { name: 'CTURGENCIA',   $: meta.urgencia      || '' },
      { name: 'CTLINKDOC',    $: meta.link_doc      || '' },
    ]
    default: return []
  }
}

module.exports = { criarChamado, atualizarStatus, buscarNuseq }// ── Criar registro na AD_CHAMADO ──────────────────────────────────────────────
async function criarChamado(chamado) {
  const p = (v, max=98) => String(v || '').substring(0, max).replace(/'/g, "''")
  const n = (v) => Number(v || 0)

  // Chama a procedure via bloco PL/SQL anônimo
  const sql = `CALL PRC_INSERT_AD_CHAMADO('${p(chamado.id,29)}','${p(chamado.tipo,29)}','${p(chamado.titulo)}','${p(chamado.status||'aguardando',19)}',${n(chamado.valor)},'${p(chamado.solicitante)}','${p(chamado.email)}','${p(chamado.autor_email)}','${p(chamado.autor_nome)}','${p(chamado.aprovador)}','${p(chamado.centro_custo)}','${p(chamado.obs,998)}')`

  console.log('[Sankhya] Chamando procedure para', chamado.id)

  return sankhyaRequest('DbExplorerSP.executeQuery', {
    sql: { $: sql },
    parameters: { $: '' }
  })
}


