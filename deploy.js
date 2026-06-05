require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Importa e lista as pendências de envio de vídeo dos últimos 7 dias (enviado por DM)')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('resolver')
    .setDescription('Resolve manualmente uma pendência pelo ID (ver em /pendencias)')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('ID completo da pendência')
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('limpar_pendencias')
    .setDescription('Remove todas as pendências em aberto')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('enviar')
    .setDescription('Envia uma ação para avaliação, vinculando à pendência correspondente')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

const GUILD_IDS = [
  process.env.GUILD_ID,
  ...(process.env.EXTRA_GUILD_IDS ? process.env.EXTRA_GUILD_IDS.split(',') : []),
].filter(Boolean);

(async () => {
  try {
    // Limpa comandos globais (evita duplicatas)
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log('🧹 Comandos globais limpos');

    for (const guildId of GUILD_IDS) {
      console.log(`Registrando no servidor ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
      console.log(`✅ Servidor ${guildId} registrado`);
    }

    console.log('\n✅ Tudo registrado!');
  } catch (err) {
    console.error('Erro:', err.message);
  }
})();
