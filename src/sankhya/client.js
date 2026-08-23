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
  const jwt  = data?.responseBody?.jsessionid?.$
  if (!jwt) throw new Error('Sankhya login falhou: ' + JSON.stringify(data).substring(0, 200))

  cachedJWT    = jwt
  jwtExpiresAt = Date.now() + 25 * 60 * 1000
  console.log('[Sankhya] Login OK, JWT obtido')
  return jwt
}

// ── Requisição genérica ───────────────────────────────────────────
async function sankhyaRequest(serviceName, requestBody) {
  const jwt = await getJWT()

  const res = await fetch(`${BASE_URL}/mge/service.sbr?serviceName=${serviceName}&outputType=json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `JSESSIONID=${jwt}`,
    },
    body: JSON.stringify({ serviceName, requestBody }),
  })

  const data = await res.json()
  console.log('[Sankhya] Resposta:', JSON.stringify(data).substring(0, 400))

  if (data?.status === '1' || data?.responseBody) return data
  const errMsg = JSON.stringify(data?.statusMessage || data?.error || data)
  throw new Error(`Sankhya [${serviceName}] erro: ${errMsg}`)
}

// ── Criar registro na AD_CHAMADO ──────────────────────────────────
async function criarChamado(chamado) {
  const meta = chamado.metadados || {}
  const hoje = fmtDate()

  const fields = [
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

  const filteredFields = fields.filter(f => f.$ !== '')

  console.log('[Sankhya] criarChamado campos:', filteredFields.map(f => f.name).join(', '))

  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: { field: filteredFields },
      },
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

module.exports = { criarChamado, atualizarStatus, buscarNuseq }
