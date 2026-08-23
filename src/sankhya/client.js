/**
 * sankhya/client.js
 * Integração com API REST Sankhya SaaS
 * Entidade: AD_CHAMADO
 */

const BASE_URL = 'https://api.sankhya.com.br'
const APP_KEY  = process.env.SANKHYA_APP_KEY
const TOKEN    = process.env.SANKHYA_TOKEN
const USERNAME = process.env.SANKHYA_USER
const PASSWORD = process.env.SANKHYA_PASS

let cachedJWT    = null
let jwtExpiresAt = 0

// ── Autenticação ──────────────────────────────────────────────────
async function getJWT() {
  if (cachedJWT && Date.now() < jwtExpiresAt) return cachedJWT

  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'appkey':    APP_KEY,
      'token':     TOKEN,
      'username':  USERNAME,
      'password':  PASSWORD,
    },
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Sankhya login falhou (${res.status}): ${txt}`)
  }

  const data = await res.json()

  // O Sankhya retorna o JWT no header ou no body dependendo da versão
  const jwt = data.bearerToken || data.token || res.headers.get('bearerToken')
  if (!jwt) throw new Error('Sankhya: JWT não encontrado na resposta de login: ' + JSON.stringify(data))

  cachedJWT    = jwt
  jwtExpiresAt = Date.now() + 25 * 60 * 1000 // 25 min
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
      'Authorization': `Bearer ${jwt}`,
      'appkey': APP_KEY,
      'token':  TOKEN,
    },
    body: JSON.stringify({ serviceName, requestBody }),
  })

  const data = await res.json()

  if (data?.status === '1' || data?.responseBody) return data
  throw new Error(`Sankhya [${serviceName}] erro: ${JSON.stringify(data?.statusMessage || data)}`)
}

// ── Criar registro na AD_CHAMADO ──────────────────────────────────
async function criarChamado(chamado) {
  const meta = chamado.metadados || {}
  const hoje = new Date().toLocaleDateString('pt-BR') // DD/MM/YYYY — formato Sankhya

  const fields = [
    // Identificação
    { name: 'IDCHAMADO',    $: chamado.id },
    { name: 'TIPO',         $: chamado.tipo },
    { name: 'TITULO',       $: chamado.titulo },
    { name: 'STATUS',       $: chamado.status || 'aguardando' },
    { name: 'VALOR',        $: String(chamado.valor) },

    // Solicitante
    { name: 'SOLICITANTE',  $: chamado.solicitante },
    { name: 'EMAILSOLICIT', $: chamado.email },
    { name: 'AUTOREMAIL',   $: chamado.autor_email },
    { name: 'AUTORNOME',    $: chamado.autor_nome },

    // Aprovação
    { name: 'APROVADOR',    $: chamado.aprovador    || '' },
    { name: 'CENTROCUSTO',  $: chamado.centro_custo || '' },
    { name: 'OBS',          $: chamado.obs          || '' },

    // Datas
    { name: 'DTABERTURA',   $: hoje },
    { name: 'DTATUALIZACAO',$: hoje },
    { name: 'SYNKOK',       $: 'S' },

    // Metadados por tipo
    ...buildMetaCampos(chamado.tipo, meta),
  ]

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
  const hoje = new Date().toLocaleDateString('pt-BR')
  return sankhyaRequest('CRUDServiceProvider.saveRecord', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
      dataRow: {
        localFields: {
          field: [
            { name: 'NUSEQ',         $: String(nuseq) },
            { name: 'STATUS',        $: status },
            { name: 'DTATUALIZACAO', $: hoje },
          ],
        },
      },
    },
  })
}

// ── Buscar NUSEQ pelo IDCHAMADO (para update) ─────────────────────
async function buscarNuseq(idChamado) {
  const data = await sankhyaRequest('CRUDServiceProvider.loadRecords', {
    dataSet: {
      rootEntity: 'AD_CHAMADO',
      includePresentationFields: 'N',
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
