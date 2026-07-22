const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
  AttachmentBuilder,
  InteractionContextType,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { generateEstagio } = require('./generateEstagio');

// ── Cargos (podem ser sobrescritos via .env) ───────────────────────────────
const AVALIADOR_ROLE_ID = process.env.AVALIADOR_ROLE_ID || '1266493758623449159';
const ESTAGIO_ROLE_ID   = process.env.ESTAGIO_ROLE_ID   || '1516985250666774729';

// Cargo usado para filtrar a lista de sugestões do campo "membro" (autocomplete).
// Só aparecem no autocomplete os membros que tiverem este cargo.
const FILTRO_MEMBRO_ROLE_ID = process.env.FILTRO_MEMBRO_ROLE_ID || '1329101772223942751';

// Canal onde a ficha é postada publicamente (opcional).
// Se não configurado, a ficha é postada no próprio canal do comando.
const AVALIACOES_CHANNEL_ID = process.env.AVALIACOES_CHANNEL_ID || null;

// ── Persistência ────────────────────────────────────────────────────────────
const DATA_DIR         = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const AVALIACOES_PATH  = path.join(DATA_DIR, 'avaliacoesEstagio.json');

const avaliacoes = [];

function loadAvaliacoes() {
  if (fs.existsSync(AVALIACOES_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(AVALIACOES_PATH, 'utf8'));
      avaliacoes.push(...data);
      console.log(`📋 ${avaliacoes.length} avaliação(ões) de estágio carregada(s).`);
    } catch (e) {
      console.warn('⚠️  Erro ao carregar avaliacoesEstagio.json:', e.message);
    }
  }
}
loadAvaliacoes();

function saveAvaliacoes() {
  fs.writeFileSync(AVALIACOES_PATH, JSON.stringify(avaliacoes, null, 2));
}

// ── Critérios ────────────────────────────────────────────────────────────
const CRITERIOS_ESTAGIO = [
  { id: 'proc_militares', label: 'Procedimentos militares' },
  { id: 'proc_unidade',   label: 'Procedimentos da unidade' },
  { id: 'comunicacao',    label: 'Comunicação efetiva' },
  { id: 'pqd',            label: 'Prática/utilização do paraquedas (PQD)' },
  { id: 'atirador',       label: 'Desempenho como atirador' },
];

const CONCEITOS = ['Ótimo', 'Bom', 'Regular', 'Ruim'];

function dataHojeBR() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// ── Helper: busca membro priorizando cache (evita chamada de rede desnecessária) ──
async function buscarMembro(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId)
    ?? await guild.members.fetch(userId).catch(() => null);
}

// ── Estado em memória das avaliações em andamento (uma por avaliador) ──────
const emAndamento = new Map(); // key = avaliadorId

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('avaliar')
    .setDescription('Avalia um estagiário do Grupamento Aeromóvel')
    .setContexts([InteractionContextType.Guild]);
}

function montarSelectMembro(candidatos) {
  const grupos = [];
  for (let i = 0; i < Math.min(candidatos.length, 125); i += 25) {
    grupos.push(candidatos.slice(i, i + 25));
  }

  return grupos.map((grupo, idx) => {
    const opcoes = grupo.map(m => ({ label: m.displayName.slice(0, 100), value: m.id }));
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`aval_sel_membro_${idx}`)
        .setPlaceholder(grupos.length > 1 ? `Grupo ${idx + 1} de ${grupos.length}` : 'Selecione o estagiário...')
        .addOptions(opcoes)
    );
  });
}

function montarPassoAtual(state) {
  const crit = state.criterios[state.indice];

  const embed = new EmbedBuilder()
    .setColor(0x18191c)
    .setAuthor({ name: `Avaliando ${state.alvoNome} · Estágio Operacional` })
    .setTitle(crit.label)
    .setFooter({ text: `Critério ${state.indice + 1} de ${state.criterios.length}` });

  const row = new ActionRowBuilder().addComponents(
    CONCEITOS.map(c =>
      new ButtonBuilder()
        .setCustomId(`aval_resp_${c}`)
        .setLabel(c)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { content: '', embeds: [embed], components: [row] };
}

async function handleInteraction(interaction, client) {
  // ── /avaliar → mostra select com os membros elegíveis ────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'avaliar') {
    const guild = interaction.guild ?? client.guilds.cache.get(process.env.GUILD_ID);

    const avaliadorMember = await buscarMembro(guild, interaction.user.id);
    if (!avaliadorMember?.roles.cache.has(AVALIADOR_ROLE_ID)) {
      await interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const role = guild?.roles.cache.get(ESTAGIO_ROLE_ID);
    const candidatos = role ? [...role.members.values()] : [];

    if (!candidatos.length) {
      await interaction.reply({ content: '❌ Nenhum membro encontrado com o cargo de Estágio. Verifique `ESTAGIO_ROLE_ID`.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.reply({
      content: '📋 **Selecione o estagiário que será avaliado:**',
      components: montarSelectMembro(candidatos),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // ── Seleção do estagiário → valida cargo e inicia o primeiro critério ────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('aval_sel_membro')) {
    const guild = interaction.guild ?? client.guilds.cache.get(process.env.GUILD_ID);
    const alvoId = interaction.values[0];
    const alvoMember = await buscarMembro(guild, alvoId);

    if (!alvoMember) {
      await interaction.update({ content: '❌ Não encontrei esse membro no servidor.', components: [] });
      return true;
    }

    const avaliadorMember = interaction.member ?? await buscarMembro(guild, interaction.user.id);

    const state = {
      alvoId: alvoMember.id,
      alvoNome: alvoMember.displayName,
      avatarUrl: alvoMember.displayAvatarURL({ extension: 'png', size: 256 }),
      avaliadorNome: avaliadorMember?.displayName ?? interaction.user.username,
      criterios: CRITERIOS_ESTAGIO.map(c => ({ label: c.label, conceito: null })),
      indice: 0,
    };
    emAndamento.set(interaction.user.id, state);

    await interaction.update(montarPassoAtual(state));
    return true;
  }

  // ── Clique num botão de conceito ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('aval_resp_')) {
    const conceito = interaction.customId.replace('aval_resp_', '');
    const state = emAndamento.get(interaction.user.id);

    if (!state) {
      await interaction.update({ content: '⚠️ Essa avaliação expirou. Use `/avaliar` novamente.', embeds: [], components: [] });
      return true;
    }

    state.criterios[state.indice].conceito = conceito;
    state.indice += 1;

    // Ainda há critérios pendentes → mostra o próximo
    if (state.indice < state.criterios.length) {
      await interaction.update(montarPassoAtual(state));
      return true;
    }

    // Último critério respondido → abre modal de observações antes de gerar a ficha
    const modal = new ModalBuilder()
      .setCustomId('aval_obs')
      .setTitle('Observações finais');

    const obsInput = new TextInputBuilder()
      .setCustomId('observacao')
      .setLabel('Observações (opcional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Comentários gerais sobre a avaliação...')
      .setMaxLength(1000)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(obsInput));

    await interaction.showModal(modal);
    return true;
  }

  // ── Submit do modal de observações → gera a ficha ────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'aval_obs') {
    const state = emAndamento.get(interaction.user.id);
    if (!state) {
      await interaction.reply({ content: '⚠️ Essa avaliação expirou. Use `/avaliar` novamente.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const observacao = interaction.fields.getTextInputValue('observacao');

    const dados = {
      nome: state.alvoNome,
      avatarUrl: state.avatarUrl,
      avaliadorNome: state.avaliadorNome,
      data: dataHojeBR(),
      criterios: state.criterios,
      observacao,
    };

    let imagePath;
    try {
      imagePath = await generateEstagio(dados);
    } catch (e) {
      console.error('❌ Erro ao gerar ficha:', e);
      await interaction.editReply({ content: '❌ Erro ao gerar a ficha de avaliação.' });
      emAndamento.delete(interaction.user.id);
      return true;
    }

    avaliacoes.push({
      avaliadoId: state.alvoId,
      avaliadoNome: state.alvoNome,
      avaliadorId: interaction.user.id,
      avaliadorNome: state.avaliadorNome,
      criterios: state.criterios,
      observacao,
      data: dados.data,
      timestamp: new Date().toISOString(),
    });
    saveAvaliacoes();

    const attachment = new AttachmentBuilder(imagePath, { name: 'ficha_avaliacao.png' });
    const canalDestino = AVALIACOES_CHANNEL_ID
      ? (client.channels.cache.get(AVALIACOES_CHANNEL_ID)
          ?? await client.channels.fetch(AVALIACOES_CHANNEL_ID).catch(() => null))
      : interaction.channel;

    if (canalDestino) {
      await canalDestino.send({ files: [attachment] });
    }
    await interaction.editReply({ content: '✅ Avaliação registrada com sucesso.' });

    fs.unlink(imagePath, () => {});
    emAndamento.delete(interaction.user.id);
    return true;
  }

  return false;
}

module.exports = { buildCommand, handleInteraction };