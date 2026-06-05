require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Aparecem em DM e no servidor
const globalCommands = [
  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Importa e lista as pendências de envio de vídeo dos últimos 7 dias (enviado por DM)')
    .setDMPermission(true)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('resolver')
    .setDescription('Resolve manualmente uma pendência pelo ID (ver em /pendencias)')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('ID completo da pendência')
        .setRequired(true)
    )
    .setDMPermission(true)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('limpar_pendencias')
    .setDescription('Remove todas as pendências em aberto')
    .setDMPermission(true)
    .toJSON(),
];

// Só no servidor, não aparece em DM
const guildCommands = [
  new SlashCommandBuilder()
    .setName('enviar')
    .setDescription('Envia uma ação para avaliação, vinculando à pendência correspondente')
    .setDMPermission(false)
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

const GUILD_IDS = [
  process.env.GUILD_ID,
  ...(process.env.EXTRA_GUILD_IDS ? process.env.EXTRA_GUILD_IDS.split(',') : []),
].filter(Boolean);

(async () => {
  try {
    // Registra globalmente (DM + servidor)
    console.log('Registrando globalmente...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: globalCommands });
    console.log('✅ Global registrado');

    // Registra /enviar só por servidor
    for (const guildId of GUILD_IDS) {
      console.log(`Registrando no servidor ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: guildCommands });
      console.log(`✅ Servidor ${guildId} registrado`);
    }

    console.log('\n✅ Tudo registrado!');
  } catch (err) {
    console.error('Erro:', err.message);
  }
})();
