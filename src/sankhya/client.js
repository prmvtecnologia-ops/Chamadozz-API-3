/**
 * sankhya/client.js
 * Integração com API REST Sankhya SaaS — Entidade AD_CHAMADO
 */

const BASE_URL = 'https://api.sankhya.com.br'
const APP_KEY  = process.env.SANKHYA_APP_KEY
const TOKEN    = process.env.SANKHYA_TOKEN
const USERNAME = process.env.SANKHYA_USER
const PASSWORD = process.env.SANKHYA_PASS

let cachedJWT    = null
let jwtExpiresAt = 0

function fmtDate(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date()
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}

// ── Autenticação ──────────────────────────────────────────────────
async function getJWT() {
  if (cachedJWT && Date.now() < jwtExpiresAt) return cachedJWT

  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'appkey':   APP_KEY,
      'token':    TOKEN,
      'username': USERNAME,
      'password': PASSWORD,
    },
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Sankhya login falhou (${res.status}): ${txt}`)
  }

  const data = await res.json()
  const jwt = data.bearerToken || data.token || res.headers.get('bearerToken')
  if (!jwt) throw new Error('Sankhya: JWT não encontrado: ' + JSON.stringify(data))

  cachedJWT    = jwt
  jwtExpiresAt = Date.now() + 25 * 60 * 1000
  console.log('[Sankhya] Login OK, JWT obtido')
  return jwt
}

// ── Requisição genérica ───────────────────────────────────────────
async function sankhyaRequest(serviceName, requestBody) {
  const jwt = await getJWT()

  const res = await fetch(`${BASE_URL}/gateway/v1/mge/service.sbr?serviceName=${serviceName}&outputType=json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      'appkey': APP_KEY,
      'token':  TOKEN,
    },
    body: JSON.stringify({ serviceName, requestBody }),
  })

  const data = await res.json()
  console.log('[Sankhya] Resposta:', JSON.stringify(data).substring(0, 300))

  if (data?.status === '1' || data?.responseBody) return data
  const errMsg = JSON.stringify(data?.statusMessage || data?.error || data)
  throw new Error(`Sankhya [${serviceName}] erro: ${errMsg}`)
}

// ── Criar registro na AD_CHAMADO ──────────────────────────────────
async function criarChamado(chamado) {
  const meta = chamado.metadados || {}
  const hoje = fmtDate(new Date())

  const fields = [
    { name: 'IDCHAMADO',    $: String(chamado.id || '') },
    { name: 'TIPO',         $: String(chamado.tipo || '') },
    { name: 'TITULO',       $: String(chamado.titulo || '') },
    { name: 'STATUS',       $: String(chamado.status || 'aguardando') },
    { name: 'VALOR',        $: String(chamado.valor || 0) },
    { name: 'SOLICITANTE',  $: String(chamado.solicitante || '') },
    { name: 'EMAILSOLICIT', $: String(chamado.email || '') },
    { name: 'AUTOREMAIL',   $: String(chamado.autor_email || '') },
    { name: 'AUTORNOME',    $: String(chamado.autor_nome || '') },
    { name: 'APROVADOR',    $: String(chamado.aprovador    || '') },
    { name: 'CENTROCUSTO',  $: String(chamado.centro_custo || '') },
    { name: 'OBS',          $: String(chamado.obs          || '') },
    { name: 'DTABERTURA',   $: hoje },
    { name: 'DTATUALIZACAO',$: hoje },
    { name: 'SYNKOK',       $: 'S' },
    ...buildMetaCampos(chamado.tipo, meta),
  ]

  console.log('[Sankhya] criarChamado campos:', fields.map(f => f.name).join(', '))

  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: { field: fields },
      },
    },
  })
}

// ── Atualizar status na AD_CHAMADO ────────────────────────────────
async function atualizarStatus(nuseq, id, status) {
  const hoje = fmtDate(new Date())
  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: {
          field: [
            { name: 'NUSEQ',         $: String(nuseq) },
            { name: 'STATUS',        $: String(status) },
            { name: 'DTATUALIZACAO', $: hoje },
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

// ── Campos extras por tipo ────────────────────────────────────────
function buildMetaCampos(tipo, meta) {
  switch (tipo) {
    case 'Viagem': return [
      { name: 'VGORIGEM',    $: meta.origem      || '' },
      { name: 'VGDESTINO',   $: meta.destino     || '' },
      { name: 'VGDATAIDA',   $: meta.data_ida    || '' },
      { name: 'VGDATAVOLTA', $: meta.data_volta  || '' },
      { name: 'VGMODAL',     $: meta.modal       || '' },
      { name: 'VGHOTEL',     $: meta.hotel_rede  || '' },
      { name: 'VGCHECKIN',   $: meta.checkin     || '' },
      { name: 'VGCHECKOUT',  $: meta.checkout    || '' },
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
      { name: 'PGVENCIMENTO',$: meta.vencimento      || '' },
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
