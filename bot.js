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
const pendingDM       = new Map();
const threadSetupMsgs = new Map(); // threadId → { setupMsgId, originalMsgId }
const pendencias      = new Map(); // id → { piloto, acao, resultado, timestamp, messageId, messageUrl }

const THREADS_PATH    = path.join(__dirname, 'pendingThreads.json');
const PENDENCIAS_PATH = path.join(__dirname, 'pendencias.json');

// ── Persistência: threads ─────────────────────────────────────────────────────
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

// ── Persistência: pendências ──────────────────────────────────────────────────
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

// ── Lista de ações ────────────────────────────────────────────────────────────
const ACOES = [
  'Fleeca Praia', 'Fleeca Shopping', 'Fleeca 68', 'Fleeca Chaves',
  'Banco Central', 'Banco de Paleto', 'Nióbio Humane', 'Joalheria',
  'Carro Forte Açougue', 'Carro Forte Groove', 'Carro Forte Faculdade',
];

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

// ── Parser do embed de pendência ──────────────────────────────────────────────
function parseEmbedPendencia(message) {
  const embed = message.embeds?.[0];
  let acao = null, piloto = null, pilotoId = null, resultado = null, id = null;

  if (embed) {
    acao      = embed.title?.trim() ?? null;
    resultado = embed.fields?.find(f => normalizar(f.name).includes('resultado'))?.value?.trim() ?? null;
    id        = embed.footer?.text?.replace(/^id[:\s]*/i, '').trim() ?? message.id;

    const pilotoField = embed.fields?.find(f => normalizar(f.name).includes('piloto'));
    if (pilotoField) {
      const val    = pilotoField.value.trim();
      const mencao = val.match(/^<@!?(\d+)>/);
      if (mencao) {
        // Campo veio como menção — extrai o ID direto
        pilotoId = mencao[1];
      } else {
        // Campo veio como texto — remove prefixo "@#XXXX " se houver
        piloto = val.replace(/^@#\d+\s*/, '').trim();
      }
    }
  } else if (message.content) {
    const lines = message.content.split('\n').map(l => l.trim()).filter(Boolean);
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
    if (!acao && lines.length > 0 && !lines[0].includes(':')) acao = lines[0];
    if (!id) id = message.id;
  }

  if (!piloto && !pilotoId && !acao) return null;
  return { piloto, pilotoId, acao, resultado, id: id ?? message.id };
}

// ── Helper: encontra membro no servidor ──────────────────────────────────────
function encontrarMembro(guild, nomePiloto, pilotoId) {
  // ID direto de menção — mais confiável
  if (pilotoId) return guild.members.cache.get(pilotoId) ?? null;

  if (!nomePiloto) return null;
  const primeiroNome = normalizar(nomePiloto).split(' ')[0];
  if (primeiroNome.length < 2) return null;

  return guild.members.cache.find(m =>
    normalizar(m.displayName) === normalizar(nomePiloto)
  ) ?? guild.members.cache.find(m =>
    normalizar(m.displayName).includes(primeiroNome)
  ) ?? null;
}

// ── Helper: registra pendência (valida cargo e mês) ───────────────────────────
// Regras:
//   - Piloto deve ter PILOT_ROLE_ID  → entra como pendência
//   - Piloto tem ALLOWED_ROLE_ID     → isento (avaliador), ignora
//   - Não encontrado / sem os cargos → ignora
//   - Só considera mensagens do mês/ano atual
async function registrarPendencia(msg) {
  const parsed = parseEmbedPendencia(msg);
  if (!parsed) return false;

  // Só o mês atual
  const agora   = new Date();
  const msgData = new Date(msg.createdAt);
  if (msgData.getMonth() !== agora.getMonth() || msgData.getFullYear() !== agora.getFullYear()) return false;

  // Não duplica
  if (pendencias.has(parsed.id)) return false;

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    const membro = encontrarMembro(guild, parsed.piloto, parsed.pilotoId);

    if (!membro) {
      console.log(`⏭️  Piloto não encontrado no servidor, ignorando: ${parsed.piloto ?? parsed.pilotoId}`);
      return false;
    }

    // Usa o display name real do servidor para exibir no /pendencias
    const nomeReal     = membro.displayName;
    const temPiloto    = membro.roles.cache.has(process.env.PILOT_ROLE_ID);
    const temAvaliador = membro.roles.cache.has(process.env.ALLOWED_ROLE_ID);

    if (temAvaliador) {
      console.log(`⏭️  Avaliador isento, ignorando: ${nomeReal}`);
      return false;
    }

    if (!temPiloto) {
      console.log(`⏭️  Sem cargo de piloto, ignorando: ${nomeReal}`);
      return false;
    }

    // Salva com o nome real do servidor (não o que veio no embed)
    parsed.piloto = nomeReal;
  }

  pendencias.set(parsed.id, {
    piloto:     parsed.piloto,
    acao:       parsed.acao,
    resultado:  parsed.resultado,
    timestamp:  msg.createdAt.toISOString(),
    messageId:  msg.id,
    messageUrl: msg.url,
  });
  savePendencias();
  console.log(`📋 Pendência registrada: ${parsed.piloto} — ${parsed.acao} (total: ${pendencias.size})`);
  return true;
}

// ── Matching: vídeo chegou → tenta resolver pendência ────────────────────────
const MATCH_THRESHOLD     = 0.38;
const DATA_TOLERANCE_DIAS = 7;

function tentarResolverPendencia(pilotoNome, timestampVideo) {
  let melhorId = null, melhorScore = 0, melhorData = null;

  for (const [id, p] of pendencias.entries()) {
    const diffDias = Math.abs(new Date(p.timestamp) - timestampVideo) / (1000 * 60 * 60 * 24);
    if (diffDias > DATA_TOLERANCE_DIAS) continue;

    const scoreData    = 1 - diffDias / DATA_TOLERANCE_DIAS;
    const primeiroNome = normalizar(p.piloto ?? '').split(' ')[0];
    const scorePiloto  = Math.max(
      dice(p.piloto ?? '', pilotoNome),
      normalizar(pilotoNome).includes(primeiroNome) && primeiroNome.length > 2 ? 0.55 : 0,
    );
    const total = scorePiloto * 0.75 + scoreData * 0.25;

    if (total > melhorScore) { melhorScore = total; melhorId = id; melhorData = p; }
  }

  if (melhorId && melhorScore >= MATCH_THRESHOLD) {
    pendencias.delete(melhorId);
    savePendencias();
    return { score: melhorScore, ...melhorData };
  }
  return null;
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  loadThreads();
  loadPendencias();

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
  // Ignora bots, exceto no canal de pendências (onde outro bot posta os embeds)
  if (message.author.bot && message.channelId !== process.env.PENDENCIAS_CHANNEL_ID) return;

  // ── Canal de pendências: registra embed como pendência ───────────────────
  if (process.env.PENDENCIAS_CHANNEL_ID && message.channelId === process.env.PENDENCIAS_CHANNEL_ID) {
    await registrarPendencia(message);
    return;
  }

  // ── Canal de ações: cria thread + tenta resolver pendência ───────────────
  if (message.channelId !== process.env.THREAD_CHANNEL_ID) return;

  const temLink    = URL_REGEX.test(message.content);
  const temArquivo = message.attachments.size > 0;
  if (!temLink && !temArquivo) return;

  try {
    const pilotoNome = message.member?.displayName ?? message.author.username;

    const resolvida = tentarResolverPendencia(pilotoNome, message.createdAt);
    if (resolvida) {
      const pct = Math.round(resolvida.score * 100);
      console.log(`✅ Pendência resolvida: ${resolvida.piloto} — ${resolvida.acao} (${pct}%)`);
    }

    const thread = await message.startThread({
      name: `Avaliação — ${pilotoNome}`,
      autoArchiveDuration: 1440,
    });

    const botao = new ButtonBuilder()
      .setCustomId('iniciar_avaliacao')
      .setLabel('📋  Iniciar Avaliação')
      .setStyle(ButtonStyle.Primary);

    const conteudoSetup = resolvida
      ? (
        `## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.\n\n` +
        `✅ **Pendência de envio resolvida!**\n` +
        `> **Ação:** ${resolvida.acao ?? '—'} | **Resultado:** ${resolvida.resultado ?? '—'}\n` +
        `> 🔗 [Ver no canal de pendências](${resolvida.messageUrl})`
      )
      : `## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.`;

    const setupMsg = await thread.send({
      content: conteudoSetup,
      components: [new ActionRowBuilder().addComponents(botao)],
    });

    threadSetupMsgs.set(thread.id, { setupMsgId: setupMsg.id, originalMsgId: message.id });
    saveThreads();
    console.log(`✅ Thread criada para ${pilotoNome}`);

    const guild       = message.guild;
    const allowedRole = guild.roles.cache.get(process.env.ALLOWED_ROLE_ID);
    if (allowedRole) {
      const threadLink = `https://discord.com/channels/${guild.id}/${thread.id}`;
      const dmTexto    = `📋 **Nova ação recebida, necessária avaliação!**\n\n**Postado por:** ${pilotoNome}\n**Acesse a thread:** ${threadLink}`;
      for (const [, member] of allowedRole.members) {
        if (member.user.bot) continue;
        try {
          await member.send(dmTexto);
          console.log(`✉️  DM enviada para ${member.displayName}`);
        } catch { console.warn(`⚠️  Não foi possível enviar DM para ${member.displayName}`); }
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Recupera dados da thread do cache ou dinamicamente pós-restart
  let threadData = threadSetupMsgs.get(interaction.channelId);

  if (!threadData) {
    console.log('⚠️  Dados não encontrados no cache, buscando na thread...');
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
        threadData = { setupMsgId, originalMsgId };
        threadSetupMsgs.set(interaction.channelId, threadData);
        saveThreads();
        console.log(`♻️  Dados recuperados: setupMsgId=${setupMsgId}, originalMsgId=${originalMsgId}`);
      }
    } catch (err) {
      console.warn('⚠️  Não foi possível recuperar dados da thread:', err.message);
    }
  }

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
        new StringSelectMenuBuilder()
          .setCustomId('sel_atirador')
          .setPlaceholder('4️⃣  Ação com Atirador?')
          .addOptions([
            { label: '🎯  Sim, com atirador', value: 'sim' },
            { label: '❌   Não',              value: 'nao' },
          ])
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

  // ── /pendencias: importa histórico + lista pendências em aberto ───────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'pendencias') {

    const guild  = client.guilds.cache.get(process.env.GUILD_ID);
    const member = await guild?.members.fetch(interaction.user.id).catch(() => null);

    if (!member || !member.roles.cache.has(process.env.ALLOWED_ROLE_ID)) {
      await interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: '⏳ Importando e verificando pendências...', flags: MessageFlags.Ephemeral });

    try {
      // Importa histórico do canal de pendências
      let importados = 0;
      if (process.env.PENDENCIAS_CHANNEL_ID) {
        const canal = await client.channels.fetch(process.env.PENDENCIAS_CHANNEL_ID);
        const msgs  = await canal.messages.fetch({ limit: 100 });
        for (const [, msg] of msgs) {
          if (!msg.author.bot) continue;
          const registrado = await registrarPendencia(msg);
          if (registrado) importados++;
        }
      }

      if (pendencias.size === 0) {
        await interaction.user.send(
          `✅ **Nenhuma pendência em aberto!**\n` +
          (importados > 0 ? `_(${importados} importada(s) do histórico, todas já resolvidas ou isentas)_` : '')
        );
        return;
      }

      const lista = [...pendencias.entries()]
        .sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));

      const cabecalho = `📋 **Pendências em aberto — ${lista.length} ação(ões)**` +
        (importados > 0 ? ` _(+${importados} importada(s) agora)_` : '') + '\n';

      const linhas = [cabecalho];
      for (const [, p] of lista) {
        const data = new Date(p.timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        linhas.push(
          `> **Piloto:** ${p.piloto ?? '—'}\n` +
          `> **Ação:** ${p.acao ?? '—'} | **Resultado:** ${p.resultado ?? '—'}\n` +
          `> **Registrado em:** ${data} | 🔗 [Ver envio](${p.messageUrl})\n`
        );
      }

      let buffer = '';
      for (const linha of linhas) {
        if ((buffer + linha).length > 1900) {
          await interaction.user.send(buffer);
          buffer = '';
        }
        buffer += linha + '\n';
      }
      if (buffer.trim()) await interaction.user.send(buffer);

    } catch (err) {
      console.error('❌ Erro em /pendencias:', err.message);
      await interaction.editReply({ content: '❌ Não consegui te enviar DM. Verifique se seus DMs estão abertos.' });
    }
    return;
  }

  // ── Botão iniciar avaliação ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'iniciar_avaliacao') {
    await abrirSelects(interaction);
    return;
  }

  // ── Selects ──────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.deferUpdate(); return; }
    if (interaction.customId === 'sel_resultado') state.resultado = interaction.values[0];
    if (interaction.customId === 'sel_acao')      state.acao      = interaction.values[0];
    if (interaction.customId === 'sel_atirador')  state.atirador  = interaction.values[0] === 'sim';
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
    if (!state?.resultado || !state?.acao || !state?.pilotoNome || state.atirador === undefined) {
      await interaction.reply({
        content: '⚠️ Selecione **resultado**, **ação**, **piloto** e se havia **atirador** antes de continuar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (state.atirador) {
      const modal = new ModalBuilder().setCustomId('form_atirador_1').setTitle('Análise — Parte 1/2');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('data').setLabel('Data').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 20/03/2026').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('spots').setLabel('Spots').setStyle(TextInputStyle.Paragraph).setPlaceholder('Análise dos spots...').setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('calls').setLabel('Calls').setStyle(TextInputStyle.Paragraph).setPlaceholder('Análise das calls...').setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('angulos').setLabel('Ângulos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Análise dos ângulos...').setRequired(false)
        ),
      );
      await interaction.showModal(modal);
    } else {
      const modal = new ModalBuilder().setCustomId('form_completo').setTitle('Análise da Ação');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('data').setLabel('Data').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 20/03/2026').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('spots').setLabel('Spots').setStyle(TextInputStyle.Paragraph).setPlaceholder('Análise dos spots...').setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('calls').setLabel('Calls').setStyle(TextInputStyle.Paragraph).setPlaceholder('Análise das calls...').setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('positivos').setLabel('Pontos Positivos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos positivos...').setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('negativos').setLabel('Pontos Negativos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos negativos...').setRequired(false)
        ),
      );
      await interaction.showModal(modal);
    }
    return;
  }

  // ── Modal completo (sem atirador) ─────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'form_completo') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.editReply({ content: '❌ Sessão expirada. Inicie uma nova avaliação.' }); return; }
    pending.delete(interaction.user.id);

    await gerarEPostar(interaction, {
      ...state,
      data:      interaction.fields.getTextInputValue('data'),
      spots:     interaction.fields.getTextInputValue('spots'),
      calls:     interaction.fields.getTextInputValue('calls'),
      melhorias: interaction.fields.getTextInputValue('positivos'),
      negativos: interaction.fields.getTextInputValue('negativos'),
      autor:     interaction.member.displayName,
    });
    return;
  }

  // ── Modal atirador parte 1 ────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'form_atirador_1') {
    const state = pending.get(interaction.user.id) ?? {};
    state.data    = interaction.fields.getTextInputValue('data');
    state.spots   = interaction.fields.getTextInputValue('spots');
    state.calls   = interaction.fields.getTextInputValue('calls');
    state.angulos = interaction.fields.getTextInputValue('angulos');
    pending.set(interaction.user.id, state);

    await interaction.reply({
      content: '**Parte 1 salva!** Clique abaixo para preencher o restante.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_parte2').setLabel('Continuar → Comportamento & Pontos').setStyle(ButtonStyle.Primary)
      )],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Botão parte 2 ─────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_parte2') {
    const modal2 = new ModalBuilder().setCustomId('form_atirador_2').setTitle('Análise — Parte 2/2');
    modal2.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('comportamento').setLabel('Comportamento Geral').setStyle(TextInputStyle.Paragraph).setPlaceholder('Comunicativo, reativo, etc...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('positivos').setLabel('Pontos Positivos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos positivos...').setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('negativos').setLabel('Pontos Negativos').setStyle(TextInputStyle.Paragraph).setPlaceholder('Pontos negativos...').setRequired(false)
      ),
    );
    await interaction.showModal(modal2);
    return;
  }

  // ── Modal atirador parte 2 ────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'form_atirador_2') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.editReply({ content: '❌ Sessão expirada. Inicie uma nova avaliação.' }); return; }
    pending.delete(interaction.user.id);

    await gerarEPostar(interaction, {
      ...state,
      comportamento: interaction.fields.getTextInputValue('comportamento'),
      melhorias:     interaction.fields.getTextInputValue('positivos'),
      negativos:     interaction.fields.getTextInputValue('negativos'),
      autor:         interaction.member.displayName,
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
        content: `Segue o relatório da sua última ação em **${dmData.acao}** - ${dmData.data}. Qualquer dúvida referente, procure por **${dmData.autor}**. <:gam:1470956318494953552>`,
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
        autor:         dados.autor,
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
    console.error(err);
    await interaction.editReply({ content: `❌ Erro: ${err.message}` });
  }
}

client.login(process.env.BOT_TOKEN);
