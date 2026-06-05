require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Lista suas pendências de envio em aberto (últimos 7 dias)'),

  new SlashCommandBuilder()
    .setName('resolver')
    .setDescription('Marca uma ou mais pendências como resolvidas')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('ID(s) da(s) pendência(s), separados por vírgula')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('limpar_pendencias')
    .setDescription('Remove todas as pendências em aberto (somente liderança)'),

  new SlashCommandBuilder()
    .setName('enviar')
    .setDescription('Envia uma ação para avaliação, vinculando à pendência correspondente'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('🔄 Registrando comandos slash...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );
    console.log('✅ Comandos registrados com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err);
  }
})();