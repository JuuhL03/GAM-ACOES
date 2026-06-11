require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Lista as pendências de envio em aberto (últimos 7 dias)'),

  new SlashCommandBuilder()
    .setName('resolver')
    .setDescription('Marca uma ou mais pendências como resolvidas'),

  new SlashCommandBuilder()
    .setName('limpar_pendencias')
    .setDescription('Remove todas as pendências em aberto (somente liderança)'),

  new SlashCommandBuilder()
    .setName('enviar')
    .setDescription('Envia uma ação para avaliação, vinculando à pendência correspondente'),

  new SlashCommandBuilder()
    .setName('relatorios')
    .setDescription('Mostra o relatório da semana atual com métricas de ações'),

  new SlashCommandBuilder()
    .setName('historico')
    .setDescription('Mostra o histórico completo (totais) de ações desde sempre'),

  new SlashCommandBuilder()
    .setName('ranking-semanal')
    .setDescription('Mostra o ranking da semana atual por ações, vitórias e derrotas'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking geral (período completo) por ações, vitórias e derrotas'),
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