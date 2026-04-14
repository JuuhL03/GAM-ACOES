// Registra os comandos nos servidores e globalmente.
// Rodar: node deploy.js

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Importa e lista as pendências de envio de vídeo do mês atual (enviado por DM)')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

const GUILD_IDS = [
  process.env.GUILD_ID,
  ...(process.env.EXTRA_GUILD_IDS ? process.env.EXTRA_GUILD_IDS.split(',') : []),
].filter(Boolean);

(async () => {
  try {
    console.log('Registrando globalmente...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Global registrado');

    for (const guildId of GUILD_IDS) {
      console.log(`Registrando no servidor ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
      console.log(`✅ Servidor ${guildId} registrado`);
    }

    console.log('\n✅ Tudo registrado!');
    console.log('Para adicionar mais servidores, coloque o ID em EXTRA_GUILD_IDS no .env separado por vírgula.');
  } catch (err) {
    console.error('Erro:', err.message);
  }
})();
