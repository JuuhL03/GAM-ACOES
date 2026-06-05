require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { generateReportImage } = require('./generateImage');
const fs   = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pending         = new Map();
const pendingEnvio    = new Map(); // estado do /enviar por piloto
const pendingDM       = new Map();
const threadSetupMsgs = new Map();
const pendencias      = new Map();
const resolvidas      = new Set();

const THREADS_PATH    = path.join(__dirname, 'pendingThreads.json');
const PENDENCIAS_PATH = path.join(__dirname, 'pendencias.json');
const RESOLVIDAS_PATH = path.join(__dirname, 'resolvidas.json');

// ── Persistência ──────────────────────────────────────────────────────────────
function loadThreads() {
  if (fs.existsSync(THREADS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(THREADS_PATH, 'utf8'));
      for (const [k, v] of Object.entries(data)) threadSetupMsgs.set(k, v);
      console.log(`📂 ${Object.keys(data).length} thread(s) carregada(s).`);
    } catch (e) { console.warn('⚠️  Erro ao carregar pendingThreads.json:', e.message); }
  }
}

function saveThreads() {
  const obj = {};
  for (const [k, v] of threadSetupMsgs.entries()) obj[k] = v;
  fs.writeFileSync(THREADS_PATH, JSON.stringify(obj, null, 2));
}

function loadPendencias() {
  if (fs.existsSync(PENDENCIAS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(PENDENCIAS_PATH, 'utf8'));
      for (const [k, v] of Object.entries(data)) pendencias.set(k, v);
      console.log(`📋 ${pendencias.size} pendência(s) carregada(s).`);
    } catch (e) { console.warn('⚠️  Erro ao carregar pendencias.json:', e.message); }
  }
}

function savePendencias() {
  const obj = {};
  for (const [k, v] of pendencias.entries()) obj[k] = v;
  fs.writeFileSync(PENDENCIAS_PATH, JSON.stringify(obj, null, 2));
}

function loadResolvidas() {
  if (fs.existsSync(RESOLVIDAS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(RESOLVIDAS_PATH, 'utf8'));
      for (const id of data) resolvidas.add(id);
      console.log(`✅ ${resolvidas.size} pendência(s) já resolvida(s) carregada(s).`);
    } catch (e) { console.warn('⚠️  Erro ao carregar resolvidas.json:', e.message); }
  }
}

function saveResolvidas() {
  fs.writeFileSync(RESOLVIDAS_PATH, JSON.stringify([...resolvidas], null, 2));
}

function resolverPendencia(id) {
  pendencias.delete(id);
  resolvidas.add(id);
  savePendencias();
  saveResolvidas();
}

// ── Helper: verifica permissão (funciona em servidor e em DM) ────────────────
async function verificarPermissao(userId) {
  const guild  = client.guilds.cache.get(process.env.GUILD_ID);
  const member = await guild?.members.fetch(userId).catch(() => null);
  return !!member?.roles.cache.has(process.env.ALLOWED_ROLE_ID);
}

// ── Helper: verifica se mensagem original já tem reação do bot ou de avaliador
async function jaFoiAvaliada(messageId) {
  if (!messageId || !process.env.THREAD_CHANNEL_ID) return false;
  try {
    const canal = await client.channels.fetch(process.env.THREAD_CHANNEL_ID);
    const msg   = await canal.messages.fetch(messageId).catch(() => null);
    if (!msg) return false;
    if (!msg.reactions.cache.size) return false;

    const guild = client.guilds.cache.get(process.env.GUILD_ID);

    for (const reacao of msg.reactions.cache.values()) {
      // Busca os usuários que reagiram (limite 10 — suficiente pro caso)
      const usuarios = await reacao.users.fetch({ limit: 10 }).catch(() => null);
      if (!usuarios) continue;

      for (const [userId, user] of usuarios) {
        // Reação do próprio bot
        if (user.id === client.user.id) return true;

        // Reação de alguém com cargo de avaliador
        if (process.env.ALLOWED_ROLE_ID && guild) {
          const membro = guild.members.cache.get(userId)
            ?? await guild.members.fetch(userId).catch(() => null);
          if (membro?.roles.cache.has(process.env.ALLOWED_ROLE_ID)) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ── Lista de ações + aliases ──────────────────────────────────────────────────
const ACOES = [
  'Fleeca Praia', 'Fleeca Shopping', 'Fleeca 68', 'Fleeca Chaves',
  'Banco Central', 'Banco de Paleto', 'Nióbio Humane', 'Joalheria',
  'Carro Forte Açougue', 'Carro Forte Groove', 'Carro Forte Faculdade',
];

const ALIASES = {
  'Banco de Paleto':       ['paleto', 'banco paleto', 'paleto day', 'paleto bank', 'bank paleto'],
  'Fleeca Praia':          ['praia', 'fleeca praia', 'flecca praia', 'fleeca beach', 'praia fleeca', 'fleeca da praia'],
  'Fleeca Shopping':       ['shopping', 'fleeca shopping', 'flecca shopping', 'shopping fleeca', 'fleeca do shopping', 'fleeca machado', 'flecca machado', 'machado'],
  'Fleeca 68':             ['68', 'fleeca 68', 'flecca 68', '68 fleeca'],
  'Fleeca Chaves':         ['chaves', 'fleeca chaves', 'flecca chaves', 'chaves fleeca'],
  'Banco Central':         ['central', 'banco central', 'central bank'],
  'Nióbio Humane':         ['niobio', 'nióbio', 'humane', 'niobio humane', 'nióbio humane'],
  'Joalheria':             ['joalheria', 'jewelry', 'joia', 'joias'],
  'Carro Forte Açougue':   ['carro forte acougue', 'carro forte açougue', 'açougue', 'acougue'],
  'Carro Forte Groove':    ['carro forte groove', 'groove'],
  'Carro Forte Faculdade': ['carro forte faculdade', 'faculdade'],
};

const FILLER = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'num', 'numa']);

function stripFiller(str) {
  return str.split(/\s+/).filter(w => !FILLER.has(w)).join(' ');
}

function resolverAcao(titulo) {
  if (!titulo) return null;
  const t         = normalizar(titulo);
  const tStripped = stripFiller(t);

  for (const [acao, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(a => {
      const na = normalizar(a);
      return t.includes(na) || tStripped.includes(stripFiller(na));
    })) return acao;
  }

  const direto = ACOES.find(a => {
    const na = normalizar(a);
    return t.includes(na) || tStripped.includes(stripFiller(na));
  });

  return direto ?? null;
}

function extrairDataDoTitulo(titulo) {
  if (!titulo) return null;
  const match = titulo.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (!match) return null;
  const dia = parseInt(match[1]);
  const mes = parseInt(match[2]) - 1;
  const ano = match[3] ? (parseInt(match[3]) < 100 ? 2000 + parseInt(match[3]) : parseInt(match[3])) : new Date().getFullYear();
  const data = new Date(ano, mes, dia);
  return isNaN(data.getTime()) ? null : data;
}

const URL_REGEX = /https?:\/\/\S+/i;

// ── Dice coefficient ──────────────────────────────────────────────────────────
function bigrams(str) {
  const s = (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function dice(a, b) {
  if (!a || !b) return 0;
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.size || !bb.size) return 0;
  let inter = 0;
  for (const bg of ba) if (bb.has(bg)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

function normalizar(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Fetch título do YouTube via oEmbed ────────────────────────────────────────
async function fetchTituloYoutube(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title ?? null;
  } catch {
    return null;
  }
}

// ── Parser do embed de pendência ──────────────────────────────────────────────
function limpar(str) {
  return (str || '').replace(/^[>|]\s*/gm, '').trim();
}

function parseEmbedPendencia(message) {
  const embed = message.embeds?.[0];
  let acao = null, piloto = null, pilotoId = null, resultado = null, id = null, tituloRaw = null;

  if (embed) {
    tituloRaw = limpar(embed.title ?? '') || null;
    acao      = resolverAcao(tituloRaw) ?? null;
    resultado = limpar(embed.fields?.find(f => normalizar(f.name).includes('resultado'))?.value ?? '');
    id        = limpar(embed.footer?.text ?? '').replace(/^id[:\s]*/i, '').trim() || message.id;

    const pilotoField = embed.fields?.find(f => normalizar(f.name).includes('piloto'));
    if (pilotoField) {
      const val    = limpar(pilotoField.value);
      const mencao = val.match(/^<@!?(\d+)>/);
      if (mencao) pilotoId = mencao[1];
      else        piloto   = val.replace(/^@#\d+\s*/, '').trim();
    }
  } else if (message.content) {
    const lines = message.content.split('\n').map(l => limpar(l)).filter(Boolean);
    for (const line of lines) {
      if (/^piloto[:\s]/i.test(line)) {
        const val    = line.replace(/^piloto[:\s]*/i, '').trim();
        const mencao = val.match(/^<@!?(\d+)>/);
        if (mencao) pilotoId = mencao[1];
        else        piloto   = val.replace(/^@#\d+\s*/, '').trim();
      }
      if (/^resultado[:\s]/i.test(line)) resultado = line.replace(/^resultado[:\s]*/i, '').trim();
      if (/^id[:\s]/i.test(line))        id        = line.replace(/^id[:\s]*/i, '').trim();
    }
    if (!acao && lines.length > 0 && !lines[0].includes(':')) {
      tituloRaw = lines[0];
      acao = resolverAcao(tituloRaw);
    }
    if (!id) id = message.id;
  }

  if (!piloto && !pilotoId && !acao && !tituloRaw) return null;
  return { piloto, pilotoId, acao: acao ?? tituloRaw, resultado: resultado || null, id: id ?? message.id };
}

// ── Helper: extrai data formatada do conteúdo da mensagem ────────────────────
function extrairDataFormatadaDaMensagem(message) {
  // Tenta extrair padrão "Data: DD/MM/AA" ou "Data: DD/MM/AAAA" do conteúdo ou campos do embed
  const fontes = [];

  if (message.embeds?.[0]) {
    const embed = message.embeds[0];
    if (embed.description) fontes.push(embed.description);
    for (const field of (embed.fields ?? [])) {
      fontes.push(field.name, field.value);
    }
  }
  if (message.content) fontes.push(message.content);

  for (const texto of fontes) {
    if (!texto) continue;
    // Busca "Data: 31/05/26" ou "Data: 31/05/2026"
    const match = texto.match(/data[:\s]+(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/i);
    if (match) {
      const dia = match[1].padStart(2, '0');
      const mes = match[2].padStart(2, '0');
      const anoRaw = match[3];
      const ano = anoRaw
        ? (parseInt(anoRaw) < 100 ? 2000 + parseInt(anoRaw) : parseInt(anoRaw))
        : new Date().getFullYear();
      return `${dia}/${mes}/${ano}`;
    }
  }

  // Fallback: qualquer data sozinha no texto
  for (const texto of fontes) {
    if (!texto) continue;
    const match = texto.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
    if (match) {
      const dia = match[1].padStart(2, '0');
      const mes = match[2].padStart(2, '0');
      const anoRaw = match[3];
      const ano = anoRaw
        ? (parseInt(anoRaw) < 100 ? 2000 + parseInt(anoRaw) : parseInt(anoRaw))
        : new Date().getFullYear();
      return `${dia}/${mes}/${ano}`;
    }
  }

  return null;
}

// ── Helper: encontra membro no servidor ──────────────────────────────────────
function encontrarMembro(guild, nomePiloto, pilotoId) {
  if (pilotoId) return guild.members.cache.get(pilotoId) ?? null;
  if (!nomePiloto) return null;
  const primeiroNome = normalizar(nomePiloto).split(' ')[0];
  if (primeiroNome.length < 2) return null;
  return guild.members.cache.find(m => normalizar(m.displayName) === normalizar(nomePiloto))
      ?? guild.members.cache.find(m => normalizar(m.displayName).includes(primeiroNome))
      ?? null;
}

// ── Helper: registra pendência ────────────────────────────────────────────────
async function registrarPendencia(msg) {
  const parsed = parseEmbedPendencia(msg);
  if (!parsed) return false;

  const agora    = new Date();
  const msgData  = new Date(msg.createdAt);
  const diffDias = (agora - msgData) / (1000 * 60 * 60 * 24);
  if (diffDias > 7) return false;

  if (pendencias.has(parsed.id)) return false;
  if (resolvidas.has(parsed.id)) return false;

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    const membro = encontrarMembro(guild, parsed.piloto, parsed.pilotoId);

    if (!membro) {
      console.log(`⏭️  Piloto não encontrado: ${parsed.piloto ?? parsed.pilotoId}`);
      return false;
    }

    const nomeReal     = membro.displayName;
    const temPiloto    = membro.roles.cache.has(process.env.PILOT_ROLE_ID);
    const temAvaliador = membro.roles.cache.has(process.env.ALLOWED_ROLE_ID);

    if (temAvaliador) { console.log(`⏭️  Avaliador isento: ${nomeReal}`); return false; }
    if (!temPiloto)   { console.log(`⏭️  Sem cargo de piloto: ${nomeReal}`); return false; }

    parsed.piloto   = nomeReal;
    parsed.pilotoId = membro.id;
  }

  // Extrai data do conteúdo da mensagem para pré-preencher o modal depois
  const dataFormatada = extrairDataFormatadaDaMensagem(msg);

  // Se a mensagem original já tem reação de avaliado, resolve direto sem registrar
  if (await jaFoiAvaliada(msg.id)) {
    resolvidas.add(parsed.id);
    saveResolvidas();
    console.log(`⏭️  Já avaliada (reação): ${parsed.piloto} — ${parsed.acao}`);
    return false;
  }

  // Fallback: usa data de envio da mensagem quando não há data explícita no texto
  const dataFinal = dataFormatada ?? (() => {
    const d = new Date(msg.createdAt);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${d.getFullYear()}`;
  })();

  pendencias.set(parsed.id, {
    piloto:        parsed.piloto,
    pilotoId:      parsed.pilotoId ?? null,
    acao:          parsed.acao,
    resultado:     parsed.resultado,
    timestamp:     msg.createdAt.toISOString(),
    messageId:     msg.id,
    messageUrl:    msg.url,
    dataFormatada: dataFinal,
  });
  savePendencias();
  console.log(`📋 Pendência registrada: ${parsed.piloto} — ${parsed.acao} (data: ${dataFinal}${dataFormatada ? '' : ' [fallback envio]'}) (total: ${pendencias.size})`);
  return true;
}

// ── Matching ──────────────────────────────────────────────────────────────────
const MATCH_THRESHOLD       = 0.38;
const MIN_PILOTO_SCORE      = 0.20;
const DATA_TOLERANCE_DIAS   = 7;

function stripPilotoId(nome) {
  return (nome || '').replace(/^#\d+\s*/, '').trim();
}

function tentarResolverPendencia(pilotoNome, timestampVideo, acaoVideo = null) {
  let melhorId = null, melhorScore = 0, melhorData = null;

  const pilotoLimpo = stripPilotoId(pilotoNome);

  for (const [id, p] of pendencias.entries()) {
    const diffDias = Math.abs(new Date(p.timestamp) - timestampVideo) / (1000 * 60 * 60 * 24);
    if (diffDias > DATA_TOLERANCE_DIAS) continue;

    const scoreData       = 1 - diffDias / DATA_TOLERANCE_DIAS;
    const pendenciaLimpo  = stripPilotoId(p.piloto ?? '');
    const primeiroNome    = normalizar(pendenciaLimpo).split(' ')[0];
    const scorePiloto     = Math.max(
      dice(pendenciaLimpo, pilotoLimpo),
      normalizar(pilotoLimpo).includes(primeiroNome) && primeiroNome.length > 2 ? 0.55 : 0,
    );

    if (scorePiloto < MIN_PILOTO_SCORE) continue;

    let scoreAcao = 0.5;
    if (acaoVideo && p.acao) {
      const acaoPendencia = resolverAcao(p.acao) ?? p.acao;
      scoreAcao = normalizar(acaoVideo) === normalizar(acaoPendencia) ? 1.0 : 0.0;
    }

    if (acaoVideo && scoreAcao === 0) continue;

    const total = scorePiloto * 0.60 + scoreAcao * 0.25 + scoreData * 0.15;
    if (total > melhorScore) { melhorScore = total; melhorId = id; melhorData = p; }
  }

  if (melhorId && melhorScore >= MATCH_THRESHOLD) {
    resolverPendencia(melhorId);
    return { score: melhorScore, id: melhorId, ...melhorData };
  }
  return null;
}

// ── Helper: tenta encontrar pendência relacionada à thread ───────────────────
function encontrarPendenciaDaThread(threadId) {
  // Busca a pendência mais recente cujo piloto seja o dono da thread
  // A thread se chama "Avaliação — <displayName>", mas aqui só temos o threadId.
  // Retornamos a pendência mais recente em aberto — o avaliador pode sobrescrever pelo select.
  const lista = [...pendencias.entries()]
    .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
  if (lista.length === 0) return null;
  return lista[0][1]; // pendência mais recente
}

// ── Parser de mensagem de piloto (formato livre, sem embed) ──────────────────
// Suporta formatos como:
//   AÇÃO: `BANCO FLEECA DA PRAIA "no tiro"` ... DATA: `30/05/2026`
//   Ação: Fleeca Shopping (Vitória) Data: 03/06/26
function parseMensagemPiloto(message) {
  const texto = message.content;
  if (!texto) return null;

  // Extrai campos chave:valor (com ou sem backticks, case-insensitive)
  // Ex: AÇÃO: `valor` ou Ação: valor
  function extrairCampo(chaves) {
    for (const chave of chaves) {
      const re = new RegExp(chave + '[:\\s]+`?([^`\\n]+)`?', 'i');
      const m  = texto.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  const acaoRaw    = extrairCampo(['a[çc][aã]o', 'acao', 'ação']);
  const dataRaw    = extrairCampo(['data']);

  // Fallback: texto livre sem prefixos (ex: "Fleeca Shopping 04/06/26 Vitória")
  if (!acaoRaw && !dataRaw) {
    // Tenta extrair data de qualquer lugar no texto
    const mData = texto.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
    if (!mData) return null; // sem data = provavelmente não é um envio de ação

    const dia    = mData[1].padStart(2, '0');
    const mes    = mData[2].padStart(2, '0');
    const anoRaw = mData[3];
    const ano    = anoRaw
      ? (parseInt(anoRaw) < 100 ? 2000 + parseInt(anoRaw) : parseInt(anoRaw))
      : new Date().getFullYear();
    const dataFormatadaLivre = `${dia}/${mes}/${ano}`;

    // Remove a data do texto e tenta resolver ação com o que sobrou
    const textoSemData = texto.replace(mData[0], '').trim();
    const acaoLivreResolvida = resolverAcao(textoSemData);
    if (!acaoLivreResolvida) return null; // não reconheceu nenhuma ação

    // Extrai resultado do texto original
    let resultadoLivre = null;
    if (/vit[oó]ria|ganhou|win/i.test(texto))       resultadoLivre = 'Vitória';
    else if (/derrota|perdeu|loss|no tiro/i.test(texto)) resultadoLivre = 'Derrota';

    const pilotoNomeLivre = message.member?.displayName ?? message.author.username;
    const pilotoIdLivre   = message.member?.id ?? message.author.id;

    return {
      piloto:        pilotoNomeLivre,
      pilotoId:      pilotoIdLivre,
      acao:          acaoLivreResolvida,
      resultado:     resultadoLivre,
      dataFormatada: dataFormatadaLivre,
      id:            message.id,
    };
  }

  // Extrai resultado da ação — "(Vitória)", "(Derrota)", "no tiro", etc.
  let resultado = null;
  if (acaoRaw) {
    const mVit  = acaoRaw.match(/\(?(vit[oó]ria|ganhou|win)\)?/i);
    const mDer  = acaoRaw.match(/\(?(derrota|perdeu|loss|no tiro)\)?/i);
    if (mVit)      resultado = 'Vitória';
    else if (mDer) resultado = 'Derrota';
  }

  // Limpa a ação removendo o resultado entre parênteses
  const acaoLimpa = acaoRaw
    ? acaoRaw.replace(/\s*\([^)]*\)\s*/g, '').replace(/["']/g, '').trim()
    : null;

  const acao = resolverAcao(acaoLimpa ?? acaoRaw) ?? acaoLimpa ?? acaoRaw;

  // Formata data para DD/MM/AAAA
  let dataFormatada = null;
  if (dataRaw) {
    const m = dataRaw.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
    if (m) {
      const dia    = m[1].padStart(2, '0');
      const mes    = m[2].padStart(2, '0');
      const anoRaw = m[3];
      const ano    = anoRaw
        ? (parseInt(anoRaw) < 100 ? 2000 + parseInt(anoRaw) : parseInt(anoRaw))
        : new Date().getFullYear();
      dataFormatada = `${dia}/${mes}/${ano}`;
    }
  }

  // Piloto vem do próprio autor da mensagem
  const pilotoNome = message.member?.displayName ?? message.author.username;
  const pilotoId   = message.member?.id ?? message.author.id;

  return {
    piloto:        pilotoNome,
    pilotoId,
    acao,
    resultado,
    dataFormatada,
    id:            message.id,
  };
}

// ── Busca resultado nas pendências do canal de bot (ação + piloto + data) ────
async function buscarResultadoNasPendencias(acao, pilotoNome, dataFormatada) {
  if (!process.env.PENDENCIAS_CHANNEL_ID) return null;

  try {
    const canal = await client.channels.fetch(process.env.PENDENCIAS_CHANNEL_ID);
    const msgs  = await canal.messages.fetch({ limit: 100 });

    let melhorResultado = null;
    let melhorScore     = 0;

    for (const [, msg] of msgs) {
      if (!msg.author.bot) continue;

      const parsed = parseEmbedPendencia(msg);
      if (!parsed?.resultado) continue;

      // Score por ação
      const acaoParsed  = resolverAcao(parsed.acao) ?? parsed.acao ?? '';
      const acaoBusca   = resolverAcao(acao) ?? acao ?? '';
      const scoreAcao   = normalizar(acaoParsed) === normalizar(acaoBusca) ? 1.0
                        : dice(normalizar(acaoParsed), normalizar(acaoBusca));
      if (scoreAcao < 0.5) continue;

      // Score por piloto
      const scorePiloto = dice(normalizar(stripPilotoId(parsed.piloto ?? '')), normalizar(stripPilotoId(pilotoNome ?? '')));
      if (scorePiloto < 0.3) continue;

      // Score por data (opcional — se tiver data nas duas pontas compara, senão ignora)
      let scoreData = 0.5;
      if (dataFormatada && parsed.acao) {
        const dataMsg = extrairDataFormatadaDaMensagem(msg);
        if (dataMsg) {
          scoreData = dataMsg === dataFormatada ? 1.0 : 0.2;
        }
      }

      const total = scoreAcao * 0.50 + scorePiloto * 0.35 + scoreData * 0.15;
      if (total > melhorScore) {
        melhorScore     = total;
        melhorResultado = parsed.resultado;
      }
    }

    if (melhorScore >= 0.55 && melhorResultado) {
      console.log(`🔍 Resultado encontrado nas pendências: "${melhorResultado}" (score: ${Math.round(melhorScore * 100)}%)`);
      return melhorResultado;
    }
  } catch (err) {
    console.warn('⚠️  Erro ao buscar resultado nas pendências:', err.message);
  }

  return null;
}

// ── Helper: tenta encontrar pendência pelo nome do piloto da thread ──────────
async function encontrarPendenciaPorThread(thread) {
  // O nome da thread é "Avaliação — <displayName>"
  const match = thread.name?.match(/^Avalia[çc][aã]o\s*[—\-]\s*(.+)$/i);
  if (!match) return null;

  const nomePilotoThread = normalizar(match[1].trim());

  // Procura pendência cujo piloto bate com o nome da thread
  let melhor = null, melhorScore = 0;
  for (const [, p] of pendencias.entries()) {
    if (!p.piloto) continue;
    const score = dice(normalizar(p.piloto), nomePilotoThread);
    if (score > melhorScore) { melhorScore = score; melhor = p; }
  }

  return melhorScore >= 0.5 ? melhor : null;
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  loadThreads();
  loadPendencias();
  loadResolvidas();

  const mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
  if (mainGuild) {
    try {
      await mainGuild.members.fetch();
      console.log(`✅ Cache carregado: ${mainGuild.name}`);
    } catch (e) { console.warn(`⚠️  Cache falhou em ${mainGuild.name}:`, e.message); }
  }
});

client.on('error', (err) => console.error('Erro no client:', err.message));

// ── Mensagens ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot && message.channelId !== process.env.PENDENCIAS_CHANNEL_ID) return;

  if (process.env.PENDENCIAS_CHANNEL_ID && message.channelId === process.env.PENDENCIAS_CHANNEL_ID) {
    await registrarPendencia(message);
    return;
  }

  if (message.channelId !== process.env.THREAD_CHANNEL_ID) return;

  // Mensagens de piloto sem link/arquivo — tenta registrar como pendência pelo formato livre
  const temLink    = URL_REGEX.test(message.content);
  const temArquivo = message.attachments.size > 0;
  if (!temLink && !temArquivo) {
    const parsedPiloto = parseMensagemPiloto(message);
    if (parsedPiloto) {
      // Verifica cargo de piloto antes de registrar
      const guild  = message.guild ?? client.guilds.cache.get(process.env.GUILD_ID);
      const membro = guild?.members.cache.get(parsedPiloto.pilotoId);
      const temPilotoCargo    = membro?.roles.cache.has(process.env.PILOT_ROLE_ID);
      const temAvaliadorCargo = membro?.roles.cache.has(process.env.ALLOWED_ROLE_ID);

      if (temAvaliadorCargo) {
        console.log(`⏭️  Mensagem de avaliador ignorada: ${parsedPiloto.piloto}`);
        return;
      }
      if (process.env.PILOT_ROLE_ID && !temPilotoCargo) {
        console.log(`⏭️  Sem cargo de piloto: ${parsedPiloto.piloto}`);
        return;
      }

      if (!pendencias.has(parsedPiloto.id) && !resolvidas.has(parsedPiloto.id)) {
        // Se não extraiu resultado do texto, tenta buscar nas pendências do canal de bot
        let resultado = parsedPiloto.resultado;
        if (!resultado) {
          resultado = await buscarResultadoNasPendencias(
            parsedPiloto.acao,
            parsedPiloto.piloto,
            parsedPiloto.dataFormatada,
          ) ?? null;
        }

        pendencias.set(parsedPiloto.id, {
          piloto:        parsedPiloto.piloto,
          pilotoId:      parsedPiloto.pilotoId,
          acao:          parsedPiloto.acao,
          resultado,
          timestamp:     message.createdAt.toISOString(),
          messageId:     message.id,
          messageUrl:    message.url,
          dataFormatada: parsedPiloto.dataFormatada ?? null,
        });
        savePendencias();
        console.log(`📋 Pendência (piloto) registrada: ${parsedPiloto.piloto} — ${parsedPiloto.acao} | resultado: ${resultado ?? '—'} (data: ${parsedPiloto.dataFormatada ?? '—'})`);
      }
    }
    return;
  }

  // Captura vídeo do piloto após /enviar
  if (temLink || temArquivo) {
    const authorId   = message.author.id;
    const envioState = pendingEnvio.get(authorId);
    if (envioState?.aguardandoVideo) {
      pendingEnvio.delete(authorId);

      const pilotoNome = envioState.pilotoNome;
      const pilotoId   = envioState.pilotoId;

      try {
        // Resolve pendência vinculada (se veio de um select)
        if (envioState.pendenciaId && pendencias.has(envioState.pendenciaId)) {
          resolverPendencia(envioState.pendenciaId);
          console.log(`✅ Pendência resolvida via /enviar: ${envioState.acao}`);
        }

        const thread = await message.startThread({
          name: `Avaliação — ${pilotoNome}`,
          autoArchiveDuration: 1440,
        });

        const botao = new ButtonBuilder()
          .setCustomId('iniciar_avaliacao')
          .setLabel('📋  Iniciar Avaliação')
          .setStyle(ButtonStyle.Primary);

        const conteudo =
          `## 📋 Avaliação de Piloto\n` +
          `> **Piloto:** ${pilotoNome} | **Ação:** ${envioState.acao ?? '—'} | **Resultado:** ${envioState.resultado ?? '—'} | **Data:** ${envioState.data ?? '—'}\n\n` +
          `Clique no botão abaixo para iniciar a avaliação.`;

        const setupMsg = await thread.send({
          content: conteudo,
          components: [new ActionRowBuilder().addComponents(botao)],
        });

        // Salva na thread os dados pré-preenchidos do /enviar
        threadSetupMsgs.set(thread.id, {
          setupMsgId:    setupMsg.id,
          originalMsgId: message.id,
          preenchido: {
            pilotoId,
            pilotoNome,
            acao:      envioState.acao,
            resultado: envioState.resultado,
            data:      envioState.data,
          },
        });
        saveThreads();
        console.log(`✅ Thread criada via /enviar para ${pilotoNome}`);

        const guild       = message.guild;
        const allowedRole = guild.roles.cache.get(process.env.ALLOWED_ROLE_ID);
        if (allowedRole) {
          const threadLink = `https://discord.com/channels/${guild.id}/${thread.id}`;
          const dmTexto    = `📋 **Nova ação recebida, necessária avaliação!**

**Postado por:** ${pilotoNome}
**Acesse a thread:** ${threadLink}`;
          for (const [, member] of allowedRole.members) {
            if (member.user.bot) continue;
            try { await member.send(dmTexto); }
            catch { console.warn(`⚠️  DM falhou para ${member.displayName}`); }
          }
        }
      } catch (err) {
        console.error('❌ Erro ao processar /enviar vídeo:', err.message);
      }
      return;
    }
  }

  try {
    const pilotoNome = message.member?.displayName ?? message.author.username;

    let acaoDoVideo      = null;
    let timestampDoVideo = message.createdAt;

    const linkMatch = message.content.match(URL_REGEX);
    if (linkMatch) {
      const url = linkMatch[0];
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const titulo = await fetchTituloYoutube(url);
        if (titulo) {
          console.log(`🎬 Título: ${titulo}`);
          acaoDoVideo = resolverAcao(titulo);
          if (acaoDoVideo) {
            console.log(`🎯 Ação reconhecida: ${acaoDoVideo}`);
          } else {
            console.log(`⏭️  Título não corresponde a nenhuma ação conhecida: "${titulo}"`);
          }
          const dataDoTitulo = extrairDataDoTitulo(titulo);
          if (dataDoTitulo) {
            timestampDoVideo = dataDoTitulo;
            console.log(`📅 Data do título: ${dataDoTitulo.toLocaleDateString('pt-BR')}`);
          }
        }
      }
    }

    // Se não extraiu ação/data pelo título do YouTube, tenta pelo corpo da mensagem
    const dadosMensagem = parseMensagemPiloto(message);
    if (dadosMensagem?.acao && !acaoDoVideo) {
      acaoDoVideo = dadosMensagem.acao;
      console.log(`📝 Ação extraída do corpo da mensagem: ${acaoDoVideo}`);
    }
    if (dadosMensagem?.dataFormatada && timestampDoVideo === message.createdAt) {
      const [d, m2, a] = dadosMensagem.dataFormatada.split('/');
      const dataObj = new Date(parseInt(a), parseInt(m2) - 1, parseInt(d));
      if (!isNaN(dataObj.getTime())) {
        timestampDoVideo = dataObj;
        console.log(`📅 Data extraída do corpo da mensagem: ${dadosMensagem.dataFormatada}`);
      }
    }

    const resolvida = acaoDoVideo
      ? tentarResolverPendencia(pilotoNome, timestampDoVideo, acaoDoVideo)
      : null;

    if (resolvida) {
      console.log(`✅ Pendência resolvida: ${resolvida.piloto} — ${resolvida.acao} (${Math.round(resolvida.score * 100)}%)`);
    }

    // Dados pré-preenchidos: pendência resolvida > corpo da mensagem > título do YouTube
    const pilotoId  = message.member?.id ?? null;
    const preenchido = (resolvida || dadosMensagem?.acao) ? {
      pilotoId,
      pilotoNome,
      acao:      resolvida?.acao           ?? dadosMensagem?.acao      ?? acaoDoVideo ?? null,
      resultado: resolvida?.resultado      ?? dadosMensagem?.resultado ?? null,
      data:      resolvida?.dataFormatada  ?? dadosMensagem?.dataFormatada ?? null,
    } : null;

    const thread = await message.startThread({
      name: `Avaliação — ${pilotoNome}`,
      autoArchiveDuration: 1440,
    });

    const botao = new ButtonBuilder()
      .setCustomId('iniciar_avaliacao')
      .setLabel('📋  Iniciar Avaliação')
      .setStyle(ButtonStyle.Primary);

    // Monta mensagem de setup com todos os campos disponíveis num formato padronizado
    // (usado também para recuperar dados após restart)
    let conteudoSetup = `## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.`;
    if (resolvida || preenchido) {
      const acao      = resolvida?.acao      ?? preenchido?.acao      ?? '—';
      const resultado = resolvida?.resultado ?? preenchido?.resultado ?? '—';
      const data      = resolvida?.dataFormatada ?? preenchido?.data  ?? '—';
      const piloto    = pilotoNome ?? '—';
      conteudoSetup =
        `## 📋 Avaliação de Piloto\n` +
        `> **Piloto:** ${piloto} | **Ação:** ${acao} | **Resultado:** ${resultado} | **Data:** ${data}\n\n` +
        (resolvida
          ? `✅ **Pendência de envio resolvida!**\n> 🔗 [Ver no canal de pendências](${resolvida.messageUrl})\n\n`
          : '') +
        `Clique no botão abaixo para iniciar a avaliação.`;
    }

    const setupMsg = await thread.send({
      content: conteudoSetup,
      components: [new ActionRowBuilder().addComponents(botao)],
    });

    threadSetupMsgs.set(thread.id, {
      setupMsgId:    setupMsg.id,
      originalMsgId: message.id,
      preenchido:    preenchido ?? null,
    });
    saveThreads();
    console.log(`✅ Thread criada para ${pilotoNome}`);

    const guild       = message.guild;
    const allowedRole = guild.roles.cache.get(process.env.ALLOWED_ROLE_ID);
    if (allowedRole) {
      const threadLink = `https://discord.com/channels/${guild.id}/${thread.id}`;
      const dmTexto    = `📋 **Nova ação recebida, necessária avaliação!**\n\n**Postado por:** ${pilotoNome}\n**Acesse a thread:** ${threadLink}`;
      for (const [, member] of allowedRole.members) {
        if (member.user.bot) continue;
        try { await member.send(dmTexto); }
        catch { console.warn(`⚠️  DM falhou para ${member.displayName}`); }
      }
    }

  } catch (err) {
    console.error('❌ Erro ao processar mensagem:', err.message);
  }
});

// ── Helper: abre selects de avaliação ─────────────────────────────────────────
async function abrirSelects(interaction) {
  const allowedRole = process.env.ALLOWED_ROLE_ID;
  if (allowedRole && !interaction.member.roles.cache.has(allowedRole)) {
    await interaction.reply({ content: '❌ Você não tem permissão para usar isto.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Recupera threadData (sem defer ainda — pode precisar abrir modal)
  let threadData = threadSetupMsgs.get(interaction.channelId);

  // Entra no bloco de recovery se não tem threadData OU se tem mas sem preenchido
  if (!threadData || !threadData.preenchido) {
    if (!threadData) console.log('⚠️  Dados não encontrados no cache, buscando na thread...');
    else console.log('⚠️  threadData sem preenchido, tentando recuperar da mensagem...');
    try {
      const thread        = interaction.channel;
      const starterMsg    = await thread.fetchStarterMessage().catch(() => null);
      const originalMsgId = starterMsg?.id ?? null;

      const msgs     = await thread.messages.fetch({ limit: 20 });
      const setupMsg = msgs.find(m =>
        m.author.id === client.user.id &&
        m.components?.length > 0 &&
        m.components[0]?.components?.[0]?.customId === 'iniciar_avaliacao'
      );
      const setupMsgId = setupMsg?.id ?? null;

      if (originalMsgId || setupMsgId) {
        // Tenta recuperar dados pré-preenchidos do conteúdo da mensagem de setup
        let preenchidoRecuperado = null;
        if (setupMsg?.content) {
          const c = setupMsg.content;
          // Extrai "Ação: X | Resultado: Y | Data: Z" ou "Piloto: P"
          const mAcao      = c.match(/\*\*Ação:\*\*\s*([^|\n]+)/);
          const mResultado = c.match(/\*\*Resultado:\*\*\s*([^|\n]+)/);
          const mData      = c.match(/\*\*Data:\*\*\s*([^|\n\>]+)/);
          const mPiloto    = c.match(/\*\*Piloto:\*\*\s*([^\n\>]+)/);

          const acao      = mAcao?.[1]?.trim().replace(/^—$/, '') || null;
          const resultado = mResultado?.[1]?.trim().replace(/^—$/, '') || null;
          const data      = mData?.[1]?.trim().replace(/^—$/, '') || null;
          const pilotoNome = mPiloto?.[1]?.trim() || null;

          // Tenta descobrir o pilotoId pelo nome
          let pilotoId = null;
          if (pilotoNome) {
            const guild  = interaction.guild;
            const membro = encontrarMembro(guild, pilotoNome, null);
            pilotoId = membro?.id ?? null;
          }

          if (acao || resultado || pilotoNome) {
            preenchidoRecuperado = { acao, resultado, data, pilotoNome, pilotoId };
            console.log(`♻️  Dados pré-preenchidos recuperados da mensagem: ${pilotoNome} | ${acao} | ${resultado}`);
          }
        }

        threadData = { setupMsgId, originalMsgId, preenchido: preenchidoRecuperado };
        threadSetupMsgs.set(interaction.channelId, threadData);
        saveThreads();
        console.log(`♻️  Dados recuperados: setupMsgId=${setupMsgId}, originalMsgId=${originalMsgId}`);
      }
    } catch (err) {
      console.warn('⚠️  Não foi possível recuperar dados da thread:', err.message);
    }
  }

  // Tenta encontrar pendência relacionada à thread para pré-preencher dados
  const pendenciaDaThread = await encontrarPendenciaPorThread(interaction.channel);
  if (pendenciaDaThread) {
    console.log(`🔍 Pendência encontrada para thread: ${pendenciaDaThread.piloto} — ${pendenciaDaThread.acao} (data: ${pendenciaDaThread.dataFormatada ?? '—'})`);
  }

  const preenchido = threadData?.preenchido ?? null;

  const pilotoNomeFinal = preenchido?.pilotoNome ?? pendenciaDaThread?.piloto   ?? null;
  const pilotoIdFinal   = preenchido?.pilotoId   ?? pendenciaDaThread?.pilotoId ?? null;
  const acaoFinal       = preenchido?.acao       ?? pendenciaDaThread?.acao     ?? null;
  const resultadoFinal  = preenchido?.resultado  ?? pendenciaDaThread?.resultado ?? null;
  const dataFinal       = preenchido?.data       ?? pendenciaDaThread?.dataFormatada ?? null;

  const temTudo = acaoFinal && resultadoFinal && pilotoNomeFinal;

  if (temTudo) {
    // Tem tudo — pula os selects e abre o modal direto
    console.log(`⚡ Pulando selects — dados completos: ${pilotoNomeFinal} | ${acaoFinal} | ${resultadoFinal}`);

    pending.set(interaction.user.id, {
      channelId:     interaction.channelId,
      setupMsgId:    threadData?.setupMsgId    ?? null,
      originalMsgId: threadData?.originalMsgId ?? null,
      pilotoNome:    pilotoNomeFinal,
      pilotoId:      pilotoIdFinal,
      acao:          acaoFinal,
      resultado:     resultadoFinal,
      dataFormatada: dataFinal,
    });

    const modal = new ModalBuilder().setCustomId('form_completo').setTitle('Análise da Ação');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('data').setLabel('Data').setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 20/03/2026').setValue(dataFinal ?? '').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('positivos').setLabel('Pontos Positivos')
          .setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos positivos...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('negativos').setLabel('Pontos Negativos')
          .setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos negativos...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('melhorias').setLabel('Melhorias')
          .setStyle(TextInputStyle.Paragraph).setPlaceholder('Sugestões de melhoria...').setRequired(false)
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // Não tem tudo — mostra selects normalmente
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role    = interaction.guild.roles.cache.get(process.env.PILOT_ROLE_ID);
  const pilotos = role
    ? role.members.map(m => ({ label: m.displayName, value: m.id })).slice(0, 25)
    : [];

  if (!pilotos.length) {
    await interaction.editReply({ content: '❌ Nenhum membro com o cargo configurado. Verifique `PILOT_ROLE_ID`.' });
    return;
  }

  pending.set(interaction.user.id, {
    channelId:     interaction.channelId,
    setupMsgId:    threadData?.setupMsgId    ?? null,
    originalMsgId: threadData?.originalMsgId ?? null,
    pilotoNomePendencia: pilotoNomeFinal,
    pilotoIdPendencia:   pilotoIdFinal,
    acaoPendencia:       acaoFinal,
    dataFormatada:       dataFinal,
    resultadoPendencia:  resultadoFinal,
  });

  await interaction.editReply({
    content: '**Novo Relatório** — preencha os campos abaixo e clique em **Abrir formulário**.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('sel_resultado')
          .setPlaceholder('1️⃣  Resultado')
          .addOptions([
            { label: '✅  Vitória', value: 'Vitória' },
            { label: '❌  Derrota', value: 'Derrota' },
          ])
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('sel_acao')
          .setPlaceholder('2️⃣  Ação')
          .addOptions(ACOES.map(a => ({ label: a, value: a })))
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('sel_piloto')
          .setPlaceholder('3️⃣  Piloto analisado')
          .addOptions(pilotos)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_abrir_form')
          .setLabel('Abrir formulário →')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  });
}

// ── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── /enviar ───────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'enviar') {
    const guild  = client.guilds.cache.get(process.env.GUILD_ID);
    const member = await guild?.members.fetch(interaction.user.id).catch(() => null);

    // Somente pilotos (ou avaliadores) podem usar
    const temPiloto    = member?.roles.cache.has(process.env.PILOT_ROLE_ID);
    const temAvaliador = member?.roles.cache.has(process.env.ALLOWED_ROLE_ID);
    if (!temPiloto && !temAvaliador) {
      await interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Busca pendências do próprio piloto ANTES de qualquer resposta
    const pilotoId   = interaction.user.id;
    const pilotoNome = member?.displayName ?? interaction.user.username;
    const agora      = new Date();

    const minhasPendencias = [...pendencias.entries()]
      .filter(([, p]) => {
        if (p.pilotoId !== pilotoId) return false;
        const dias = (agora - new Date(p.timestamp)) / (1000 * 60 * 60 * 24);
        return dias <= 14;
      })
      .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));

    if (minhasPendencias.length === 0) {
      // Sem pendências — modal tem que ser a PRIMEIRA resposta (sem defer antes)
      pendingEnvio.set(interaction.user.id, {
        pilotoId,
        pilotoNome,
        pendenciaId: null,
        acao:        null,
        resultado:   null,
        data:        null,
      });

      const modal = new ModalBuilder().setCustomId('enviar_manual').setTitle('Enviar Ação');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('env_acao').setLabel('Ação').setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Fleeca Shopping').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('env_data').setLabel('Data').setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 30/05/2026').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('env_resultado').setLabel('Resultado').setStyle(TextInputStyle.Short)
            .setPlaceholder('Vitória ou Derrota').setRequired(false)
        ),
      );
      await interaction.showModal(modal);
      return;
    }

    // Com pendências — aí sim pode defer e mostrar select
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const opcoes = minhasPendencias.slice(0, 25).map(([id, p]) => {
      const data  = p.dataFormatada ?? new Date(p.timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const label = `${p.acao ?? '—'} — ${data}${p.resultado ? ' (' + p.resultado + ')' : ''}`;
      return { label: label.slice(0, 100), value: id };
    });

    pendingEnvio.set(interaction.user.id, { pilotoId, pilotoNome });

    await interaction.editReply({
      content: `📋 **Selecione a pendência que você está enviando:**`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('sel_enviar_pendencia')
            .setPlaceholder('Selecione a ação...')
            .addOptions(opcoes)
        ),
      ],
    });
    return;
  }

  // ── /pendencias ───────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'pendencias') {
    if (!await verificarPermissao(interaction.user.id)) {
      await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
      return;
    }

    const emDM = !interaction.guild;
    if (!emDM) await interaction.reply({ content: '⏳ Importando e verificando pendências...', flags: MessageFlags.Ephemeral });

    try {
      let importados = 0;
      if (process.env.PENDENCIAS_CHANNEL_ID) {
        const canal = await client.channels.fetch(process.env.PENDENCIAS_CHANNEL_ID);
        const msgs  = await canal.messages.fetch({ limit: 100 });
        for (const [, msg] of msgs) {
          if (!msg.author.bot) continue;
          const ok = await registrarPendencia(msg);
          if (ok) importados++;
        }
      }

      // Varre pendências em aberto e resolve as que já têm reação no canal
      let autoResolvidas = 0;
      for (const [id, p] of [...pendencias.entries()]) {
        if (await jaFoiAvaliada(p.messageId)) {
          resolverPendencia(id);
          autoResolvidas++;
          console.log(`⏭️  Auto-resolvida por reação: ${p.piloto} — ${p.acao}`);
        }
      }
      if (autoResolvidas > 0) console.log(`✅ ${autoResolvidas} pendência(s) auto-resolvida(s) por reação`);

      const agora = new Date();
      const lista = [...pendencias.entries()]
        .filter(([, p]) => (agora - new Date(p.timestamp)) / (1000 * 60 * 60 * 24) <= 7)
        .sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));

      if (lista.length === 0) {
        const msgVazia = `✅ **Nenhuma pendência em aberto nos últimos 7 dias!**\n` +
          (importados > 0 ? `_(${importados} importada(s), todas resolvidas ou isentas)_` : '');
        if (emDM) await interaction.reply({ content: msgVazia });
        else await interaction.user.send(msgVazia);
        return;
      }

      const cabecalho = `📋 **Pendências em aberto — ${lista.length} ação(ões) nos últimos 7 dias**` +
        (importados > 0 ? ` _(+${importados} importada(s) agora)_` : '') + '\n';

      const linhas = [cabecalho];
      for (const [id, p] of lista) {
        const data = new Date(p.timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        linhas.push(
          `> **Piloto:** ${p.piloto ?? '—'}\n` +
          `> **Ação:** ${p.acao ?? '—'} | **Resultado:** ${p.resultado ?? '—'}\n` +
          `> **Registrado em:** ${data} | ID: \`${id}\` | 🔗 [Ver envio](${p.messageUrl})\n`
        );
      }

      let buffer = '';
      let primeiroEnvio = true;
      for (const linha of linhas) {
        if ((buffer + linha).length > 1900) {
          if (emDM && primeiroEnvio) { await interaction.reply({ content: buffer }); primeiroEnvio = false; }
          else if (emDM) { await interaction.followUp({ content: buffer }); }
          else await interaction.user.send(buffer);
          buffer = '';
        }
        buffer += linha + '\n';
      }
      if (buffer.trim()) {
        if (emDM && primeiroEnvio) await interaction.reply({ content: buffer });
        else if (emDM) await interaction.followUp({ content: buffer });
        else await interaction.user.send(buffer);
      }

    } catch (err) {
      console.error('❌ Erro em /pendencias:', err.message);
      try {
        if (emDM) await interaction.reply({ content: '❌ Erro ao buscar pendências.' });
        else await interaction.editReply({ content: '❌ Não consegui te enviar DM. Verifique se seus DMs estão abertos.' });
      } catch { /* já respondido */ }
    }
    return;
  }

  // ── /resolver ─────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'resolver') {
    if (!await verificarPermissao(interaction.user.id)) {
      await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
      return;
    }

    const input = interaction.options.getString('id')?.trim();
    if (!input) {
      await interaction.reply({ content: '❌ Informe o(s) ID(s) da(s) pendência(s).', flags: MessageFlags.Ephemeral });
      return;
    }

    const ids = input.split(',').map(s => s.trim()).filter(Boolean);

    const resultados = [];
    let okCount = 0, failCount = 0;

    for (const id of ids) {
      if (!pendencias.has(id)) {
        resultados.push(`❌ \`${id}\` — não encontrada`);
        failCount++;
        continue;
      }
      const p = pendencias.get(id);
      resolverPendencia(id);
      resultados.push(`✅ \`${id}\` — ${p.piloto ?? '—'} | ${p.acao ?? '—'}`);
      okCount++;
    }

    const resumo = ids.length > 1
      ? `**${okCount} resolvida(s), ${failCount} não encontrada(s)**\n\n`
      : '';

    await interaction.reply({
      content: resumo + resultados.join('\n'),
      flags: MessageFlags.Ephemeral,
    });

    console.log(`🗑️  Resolver batch: ${okCount} ok, ${failCount} falha (por ${interaction.user.tag})`);
    return;
  }

  // ── /limpar_pendencias ──────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'limpar_pendencias') {
    if (!await verificarPermissao(interaction.user.id)) {
      await interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
      return;
    }

    const total = pendencias.size;
    for (const id of pendencias.keys()) resolvidas.add(id);
    pendencias.clear();
    savePendencias();
    saveResolvidas();

    await interaction.reply({
      content: `🗑️ **${total} pendência(s) removida(s).** Lista limpa.`,
      flags: MessageFlags.Ephemeral,
    });

    console.log(`🗑️  Pendências limpas: ${total} removida(s) (por ${interaction.user.tag})`);
    return;
  }

  // ── Botão iniciar avaliação ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'iniciar_avaliacao') {
    await abrirSelects(interaction);
    return;
  }

  // ── Select /enviar — escolha de pendência ──────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'sel_enviar_pendencia') {
    const state = pendingEnvio.get(interaction.user.id);
    if (!state) { await interaction.deferUpdate(); return; }

    const pendenciaId = interaction.values[0];
    const p           = pendencias.get(pendenciaId);

    state.pendenciaId = pendenciaId;
    state.acao        = p?.acao        ?? null;
    state.resultado   = p?.resultado   ?? null;
    state.data        = p?.dataFormatada ?? null;
    pendingEnvio.set(interaction.user.id, state);

    const acao      = p?.acao ?? '—';
    const data      = p?.dataFormatada ?? '—';
    const resultado = p?.resultado ?? '—';

    await interaction.update({
      content: `✅ **Selecionado:** ${acao} — ${data} (${resultado})

Agora **envie o vídeo** aqui no canal de ações.`,
      components: [],
    });

    // Aguarda o vídeo: abre uma coleta por DM ou aguarda a próxima mensagem no canal
    // Registra o estado para capturar a próxima mensagem com vídeo do piloto
    pendingEnvio.set(interaction.user.id, { ...state, aguardandoVideo: true, channelId: interaction.channelId });
    return;
  }

  // ── Modal /enviar manual (sem pendências) ────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'enviar_manual') {
    const state = pendingEnvio.get(interaction.user.id);
    if (!state) { await interaction.reply({ content: '❌ Sessão expirada.', flags: MessageFlags.Ephemeral }); return; }

    const acaoRaw    = interaction.fields.getTextInputValue('env_acao').trim();
    const dataRaw    = interaction.fields.getTextInputValue('env_data').trim();
    const resultRaw  = interaction.fields.getTextInputValue('env_resultado').trim();

    state.acao      = resolverAcao(acaoRaw) ?? acaoRaw;
    state.data      = dataRaw;
    state.resultado = resultRaw || null;
    state.aguardandoVideo = true;
    state.channelId = interaction.channelId;
    pendingEnvio.set(interaction.user.id, state);

    await interaction.reply({
      content: `✅ **Registrado:** ${state.acao} — ${state.data}${state.resultado ? ' (' + state.resultado + ')' : ''}

Agora **envie o vídeo** aqui no canal de ações.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Selects ──────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.deferUpdate(); return; }
    if (interaction.customId === 'sel_resultado') state.resultado = interaction.values[0];
    if (interaction.customId === 'sel_acao')      state.acao      = interaction.values[0];
    if (interaction.customId === 'sel_piloto') {
      const m = interaction.guild.members.cache.get(interaction.values[0]);
      state.pilotoId   = interaction.values[0];
      state.pilotoNome = m ? m.displayName : interaction.values[0];
    }
    pending.set(interaction.user.id, state);
    await interaction.deferUpdate();
    return;
  }

  // ── Botão "Abrir formulário" ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_abrir_form') {
    const state = pending.get(interaction.user.id);
    // Fallback de resultado e ação dos dados pré-preenchidos (/enviar ou pendência)
    if (!state.resultado && state.resultadoPendencia) {
      state.resultado = state.resultadoPendencia;
      console.log(`🔄 Resultado preenchido via fallback: ${state.resultado}`);
    }
    if (!state.acao && state.acaoPendencia) {
      state.acao = state.acaoPendencia;
      console.log(`🔄 Ação preenchida via fallback: ${state.acao}`);
    }

    if (!state?.resultado || !state?.acao) {
      await interaction.reply({
        content: '⚠️ Selecione **resultado** e **ação** antes de continuar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Fallback: se avaliador não selecionou piloto no select, usa o da pendência
    if (!state.pilotoNome && state.pilotoNomePendencia) {
      state.pilotoNome = state.pilotoNomePendencia;
      state.pilotoId   = state.pilotoIdPendencia ?? null;
      console.log(`🔄 Piloto preenchido via fallback de pendência: ${state.pilotoNome}`);
    }

    if (!state.pilotoNome) {
      await interaction.reply({
        content: '⚠️ Selecione o **piloto** antes de continuar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder().setCustomId('form_completo').setTitle('Análise da Ação');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('data')
          .setLabel('Data')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 20/03/2026')
          .setValue(state.dataFormatada ?? '')   // ← pré-preenchido
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('positivos').setLabel('Pontos Positivos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos positivos...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('negativos').setLabel('Pontos Negativos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos negativos...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('melhorias').setLabel('Melhorias').setStyle(TextInputStyle.Paragraph).setPlaceholder('Sugestões de melhoria...').setRequired(false)
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // ── Modal completo ────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'form_completo') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.editReply({ content: '❌ Sessão expirada. Inicie uma nova avaliação.' }); return; }
    pending.delete(interaction.user.id);

    await gerarEPostar(interaction, {
      ...state,
      data:      interaction.fields.getTextInputValue('data'),
      positivos: interaction.fields.getTextInputValue('positivos'),
      negativos: interaction.fields.getTextInputValue('negativos'),
      melhorias: interaction.fields.getTextInputValue('melhorias'),
    });
    return;
  }

  // ── Botão DM — Não ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'dm_nao') {
    const dmData = pendingDM.get(interaction.user.id);
    pendingDM.delete(interaction.user.id);
    if (dmData) fs.unlink(dmData.imagePath, () => {});
    await interaction.update({ content: '✅ Relatório postado!', components: [] });
    await finalizarThread(dmData);
    return;
  }

  // ── Botão DM — Sim ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'dm_sim') {
    const dmData = pendingDM.get(interaction.user.id);
    pendingDM.delete(interaction.user.id);

    if (!dmData) {
      await interaction.update({ content: '✅ Relatório postado!', components: [] });
      return;
    }

    try {
      const membro = await interaction.guild.members.fetch(dmData.pilotoId);
      await membro.send({
        content: `Segue o relatório da sua última ação em **${dmData.acao}** - ${dmData.data}.`,
        files: [dmData.imagePath],
      });
      await interaction.update({ content: `✅ Relatório postado e enviado por DM para **${dmData.pilotoNome}**!`, components: [] });
    } catch {
      await interaction.update({ content: `✅ Relatório postado, mas não foi possível enviar DM para **${dmData.pilotoNome}** (pode estar com DMs fechadas).`, components: [] });
    } finally {
      fs.unlink(dmData.imagePath, () => {});
    }

    await finalizarThread(dmData);
    return;
  }

});

// ── Helper: apaga msg da thread + reação na msg original ──────────────────────
async function finalizarThread(dmData) {
  if (!dmData) return;

  if (dmData.setupMsgId && dmData.channelId) {
    try {
      const thread   = await client.channels.fetch(dmData.channelId);
      const setupMsg = await thread.messages.fetch(dmData.setupMsgId);
      await setupMsg.delete();
      threadSetupMsgs.delete(dmData.channelId);
      saveThreads();
      console.log('🧹 Mensagem de avaliação removida da thread.');
    } catch (err) {
      console.warn('⚠️  Não foi possível apagar mensagem da thread:', err.message);
    }
  }

  if (dmData.originalMsgId) {
    try {
      const canal       = await client.channels.fetch(process.env.THREAD_CHANNEL_ID);
      const originalMsg = await canal.messages.fetch(dmData.originalMsgId);
      await originalMsg.react('1330606335988990045');
      console.log('✅ Reação adicionada na mensagem original.');
    } catch (err) {
      console.warn('⚠️  Não foi possível reagir na mensagem original:', err.message);
    }
  }
}

// ── Helper: gera imagem e posta no canal ──────────────────────────────────────
async function gerarEPostar(interaction, dados) {
  try {
    const imagePath = await generateReportImage(dados);
    const canal     = client.channels.cache.get(dados.channelId);

    if (!canal) {
      await interaction.editReply({ content: '❌ Não consegui acessar o canal. Verifique as permissões do bot.' });
      return;
    }

    await canal.send({ files: [imagePath] });

    if (dados.pilotoId) {
      pendingDM.set(interaction.user.id, {
        imagePath,
        pilotoId:      dados.pilotoId,
        pilotoNome:    dados.pilotoNome,
        acao:          dados.acao,
        data:          dados.data,
        channelId:     dados.channelId,
        setupMsgId:    dados.setupMsgId    ?? null,
        originalMsgId: dados.originalMsgId ?? null,
      });

      const btnSim = new ButtonBuilder().setCustomId('dm_sim').setLabel('✉️  Sim, enviar').setStyle(ButtonStyle.Success);
      const btnNao = new ButtonBuilder().setCustomId('dm_nao').setLabel('Não').setStyle(ButtonStyle.Secondary);

      await interaction.editReply({
        content: `✅ Relatório postado!\n\nDeseja enviar o relatório por DM para **${dados.pilotoNome}**?`,
        components: [new ActionRowBuilder().addComponents(btnSim, btnNao)],
      });
    } else {
      await interaction.editReply({ content: '✅ Relatório postado!' });
      fs.unlink(imagePath, () => {});
      await finalizarThread(dados);
    }
  } catch (err) {
    console.error('❌ Erro em gerarEPostar:', err);
    try { await interaction.editReply({ content: `❌ Erro: ${err.message}` }); } catch { /* interaction pode ter expirado */ }
  }
}

client.login(process.env.BOT_TOKEN);
