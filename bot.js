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

const JSON_PATH = path.join(__dirname, 'pendingThreads.json');

function loadThreads() {
  if (fs.existsSync(JSON_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      for (const [threadId, val] of Object.entries(data)) {
        threadSetupMsgs.set(threadId, val);
      }
      console.log(`📂 ${Object.keys(data).length} thread(s) pendente(s) carregada(s).`);
    } catch (e) {
      console.warn('⚠️  Erro ao carregar pendingThreads.json:', e.message);
    }
  }
}

function saveThreads() {
  const obj = {};
  for (const [k, v] of threadSetupMsgs.entries()) obj[k] = v;
  fs.writeFileSync(JSON_PATH, JSON.stringify(obj, null, 2));
}

const ACOES = [
  'Fleeca Praia', 'Fleeca Shopping', 'Fleeca 68', 'Fleeca Chaves',
  'Banco Central', 'Banco de Paleto', 'Nióbio Humane', 'Joalheria',
  'Carro Forte Açougue', 'Carro Forte Groove', 'Carro Forte Faculdade',
];

const URL_REGEX = /https?:\/\/\S+/i;

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

  loadThreads();

  const mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
  if (mainGuild) {
    try {
      await mainGuild.members.fetch();
      console.log(`✅ Cache carregado: ${mainGuild.name}`);
    } catch (e) {
      console.warn(`⚠️  Cache falhou em ${mainGuild.name}:`, e.message);
    }
  }
});

client.on('error', (err) => console.error('Erro no client:', err.message));

// ── Auto-thread ao postar link ou arquivo ──────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== process.env.THREAD_CHANNEL_ID) return;

  const temLink    = URL_REGEX.test(message.content);
  const temArquivo = message.attachments.size > 0;
  if (!temLink && !temArquivo) return;

  try {
    const thread = await message.startThread({
      name: `Avaliação — ${message.member?.displayName ?? message.author.username}`,
      autoArchiveDuration: 1440,
    });

    const botao = new ButtonBuilder()
      .setCustomId('iniciar_avaliacao')
      .setLabel('📋  Iniciar Avaliação')
      .setStyle(ButtonStyle.Primary);

    const setupMsg = await thread.send({
      content: '## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.',
      components: [new ActionRowBuilder().addComponents(botao)],
    });

    threadSetupMsgs.set(thread.id, {
      setupMsgId:    setupMsg.id,
      originalMsgId: message.id,
    });
    saveThreads();

    console.log(`✅ Thread criada para ${message.member?.displayName}`);

    // DM para avaliadores
    const guild       = message.guild;
    const allowedRole = guild.roles.cache.get(process.env.ALLOWED_ROLE_ID);
    if (allowedRole) {
      const threadLink = `https://discord.com/channels/${guild.id}/${thread.id}`;
      const dmTexto    = `📋 **Nova ação recebida, necessária avaliação!**\n\n**Postado por:** ${message.member?.displayName ?? message.author.username}\n**Acesse a thread:** ${threadLink}`;
      for (const [, member] of allowedRole.members) {
        if (member.user.bot) continue;
        try {
          await member.send(dmTexto);
          console.log(`✉️  DM enviada para ${member.displayName}`);
        } catch {
          console.warn(`⚠️  Não foi possível enviar DM para ${member.displayName}`);
        }
      }
    }

  } catch (err) {
    console.error('❌ Erro ao criar thread:', err.message);
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

  const role    = interaction.guild.roles.cache.get(process.env.PILOT_ROLE_ID);
  const pilotos = role
    ? role.members.map(m => ({ label: m.displayName, value: m.id })).slice(0, 25)
    : [];

  if (!pilotos.length) {
    await interaction.editReply({ content: '❌ Nenhum membro com o cargo configurado. Verifique `PILOT_ROLE_ID`.' });
    return;
  }

  const threadData = threadSetupMsgs.get(interaction.channelId);

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

  if (interaction.isChatInputCommand() && interaction.commandName === 'relatorio') {
    await abrirSelects(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === 'iniciar_avaliacao') {
    await abrirSelects(interaction);
    return;
  }

  // ── Selects ──────────────────────────────────────────────────────────────────
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

  // ── Botão "Abrir formulário" ──────────────────────────────────────────────────
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

  // ── Modal único (sem atirador) ────────────────────────────────────────────────
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

  // ── Modal atirador parte 1 ────────────────────────────────────────────────────
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

  // ── Botão parte 2 ─────────────────────────────────────────────────────────────
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

  // ── Modal atirador parte 2 ────────────────────────────────────────────────────
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

  // ── Botão DM — Não ───────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'dm_nao') {
    const dmData = pendingDM.get(interaction.user.id);
    pendingDM.delete(interaction.user.id);
    if (dmData) fs.unlink(dmData.imagePath, () => {});
    await interaction.update({ content: '✅ Relatório postado!', components: [] });
    await finalizarThread(dmData);
    return;
  }

  // ── Botão DM — Sim ───────────────────────────────────────────────────────────
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
