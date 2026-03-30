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
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const pending = new Map();
const pendingDM = new Map();

const ACOES = [
  'Fleeca Praia', 'Fleeca Shopping', 'Fleeca 68', 'Fleeca Chaves',
  'Banco Central', 'Banco de Paleto', 'Nióbio Humane', 'Joalheria',
  'Carro Forte Açougue', 'Carro Forte Groove', 'Carro Forte Faculdade',
];

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

  const mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
  if (mainGuild) {
    try {
      await mainGuild.members.fetch();
      console.log(`✅ Cache carregado: ${mainGuild.name}`);
    } catch (e) {
      console.warn(`⚠️  Cache falhou em ${mainGuild.name}:`, e.message);
    }
  }

  // ── Mensagem fixa de avaliação ────────────────────────────────────────────
  if (process.env.SETUP_CHANNEL_ID) {
    try {
      const canal = await client.channels.fetch(process.env.SETUP_CHANNEL_ID);

      const botao = new ButtonBuilder()
        .setCustomId('iniciar_avaliacao')
        .setLabel('📋  Iniciar Avaliação')
        .setStyle(ButtonStyle.Primary);

      await canal.send({
        content: '## 📋 Avaliação de Piloto\nClique no botão abaixo para iniciar uma nova avaliação.',
        components: [new ActionRowBuilder().addComponents(botao)],
      });

      console.log('✅ Mensagem de avaliação postada no canal de setup.');
    } catch (err) {
      console.error('❌ Erro ao postar mensagem de setup:', err.message);
    }
  }
});

client.on('error', (err) => console.error('Erro no client:', err.message));

// ── Helper: abre os selects de avaliação (usado pelo /relatorio e pelo botão fixo) ──
async function abrirSelects(interaction) {
  const allowedRole = process.env.ALLOWED_ROLE_ID;
  if (allowedRole && !interaction.member.roles.cache.has(allowedRole)) {
    await interaction.reply({ content: '❌ Você não tem permissão para usar isto.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role = interaction.guild.roles.cache.get(process.env.PILOT_ROLE_ID);
  const pilotos = role
    ? role.members.map(m => ({ label: m.displayName, value: m.id })).slice(0, 25)
    : [];

  if (!pilotos.length) {
    await interaction.editReply({ content: '❌ Nenhum membro com o cargo configurado. Verifique `PILOT_ROLE_ID`.' });
    return;
  }

  pending.set(interaction.user.id, { channelId: interaction.channelId });

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
            { label: '❌   Não', value: 'nao' },
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

// ── Interactions ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── /relatorio ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'relatorio') {
    await abrirSelects(interaction);
  }

  // ── Botão fixo "Iniciar Avaliação" ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'iniciar_avaliacao') {
    await abrirSelects(interaction);
    return;
  }

  // ── Selects ─────────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const state = pending.get(interaction.user.id);
    if (!state) { await interaction.deferUpdate(); return; }

    if (interaction.customId === 'sel_resultado') state.resultado  = interaction.values[0];
    if (interaction.customId === 'sel_acao')      state.acao       = interaction.values[0];
    if (interaction.customId === 'sel_atirador')  state.atirador   = interaction.values[0] === 'sim';
    if (interaction.customId === 'sel_piloto') {
      const m = interaction.guild.members.cache.get(interaction.values[0]);
      state.pilotoId   = interaction.values[0];
      state.pilotoNome = m ? m.displayName : interaction.values[0];
    }
    pending.set(interaction.user.id, state);
    await interaction.deferUpdate();
  }

  // ── Botão "Abrir formulário" ────────────────────────────────────────────────
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
  }

  // ── Modal único (sem atirador) ──────────────────────────────────────────────
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
  }

  // ── Modal com atirador parte 1 ──────────────────────────────────────────────
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
  }

  // ── Botão parte 2 ───────────────────────────────────────────────────────────
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
  }

  // ── Modal com atirador parte 2 ──────────────────────────────────────────────
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
  }

  // ── Botões de confirmação de DM ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'dm_nao') {
    const dmData = pendingDM.get(interaction.user.id);
    pendingDM.delete(interaction.user.id);
    if (dmData) fs.unlink(dmData.imagePath, () => {});
    await interaction.update({ content: '✅ Relatório postado!', components: [] });
    return;
  }

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
    } catch (err) {
      await interaction.update({ content: `✅ Relatório postado, mas não foi possível enviar DM para **${dmData.pilotoNome}** (pode estar com DMs fechadas).`, components: [] });
    } finally {
      fs.unlink(dmData.imagePath, () => {});
    }
    return;
  }

});

// ── Helper: gera imagem e posta no canal ──────────────────────────────────────
async function gerarEPostar(interaction, dados) {
  try {
    const imagePath = await generateReportImage(dados);
    const canal = client.channels.cache.get(dados.channelId);
    if (!canal) {
      await interaction.editReply({ content: '❌ Não consegui acessar o canal. Verifique as permissões do bot.' });
      return;
    }
    await canal.send({ files: [imagePath] });

    if (dados.pilotoId) {
      pendingDM.set(interaction.user.id, { imagePath, pilotoId: dados.pilotoId, pilotoNome: dados.pilotoNome, acao: dados.acao, data: dados.data, autor: dados.autor });
      const btnSim = new ButtonBuilder().setCustomId('dm_sim').setLabel('✉️  Sim, enviar').setStyle(ButtonStyle.Success);
      const btnNao = new ButtonBuilder().setCustomId('dm_nao').setLabel('Não').setStyle(ButtonStyle.Secondary);
      await interaction.editReply({
        content: `✅ Relatório postado!\n\nDeseja enviar o relatório por DM para **${dados.pilotoNome}**?`,
        components: [new ActionRowBuilder().addComponents(btnSim, btnNao)],
      });
    } else {
      await interaction.editReply({ content: '✅ Relatório postado!' });
      fs.unlink(imagePath, () => {});
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply({ content: `❌ Erro: ${err.message}` });
  }
}

client.login(process.env.BOT_TOKEN);
