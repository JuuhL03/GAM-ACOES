// Registra o comando nos dois servidores listados E globalmente.
// Rodar: node deploy.js

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const command = new SlashCommandBuilder()
  .setName('relatorio')
  .setDescription('Abre o formulário para criar um relatório de ação')
  .toJSON();

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

// Adicione aqui os IDs de todos os servidores que devem ter o comando
const GUILD_IDS = [
  process.env.GUILD_ID,
  ...(process.env.EXTRA_GUILD_IDS ? process.env.EXTRA_GUILD_IDS.split(',') : []),
].filter(Boolean);

(async () => {
  try {
    // Registro global (funciona em todos, mas demora até 1h)
    console.log('Registrando globalmente...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [command] });
    console.log('✅ Global registrado');

    // Registro por servidor (instantâneo)
    for (const guildId of GUILD_IDS) {
      console.log(`Registrando no servidor ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: [command] });
      console.log(`✅ Servidor ${guildId} registrado`);
    }

    console.log('\n✅ Tudo registrado! Comandos por servidor são instantâneos.');
    console.log('Para adicionar mais servidores, coloque o ID em EXTRA_GUILD_IDS no .env separado por vírgula.');
  } catch (err) {
    console.error('Erro:', err.message);
  }
})();
