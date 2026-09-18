require('dotenv').config();
const {
  REST,
  Routes,
  SlashCommandBuilder,
  InteractionContextType,
} = require('discord.js');
const avaliarCmd = require('./avaliar');

// IDs públicos (não são segredo) — podem ser sobrescritos via .env.
// BOT_TOKEN fica de fora de propósito: é credencial e nunca deve ter valor padrão no código.
const CLIENT_ID = process.env.CLIENT_ID || '1487702951374880910';
const GUILD_ID  = process.env.GUILD_ID  || '1328875439866908814';

// Contextos onde o comando pode ser usado: dentro do servidor E em DM com o bot
const CONTEXTS = [InteractionContextType.Guild, InteractionContextType.BotDM];

const commands = [

  avaliarCmd.buildCommand(), // /avaliar — guild-only (definido no próprio avaliar.js)

  new SlashCommandBuilder()
    .setName('pendencias')
    .setDescription('Lista as pendências de envio em aberto (últimos 7 dias)')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('resolver')
    .setDescription('Marca uma ou mais pendências como resolvidas')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('limpar_pendencias')
    .setDescription('Remove todas as pendências em aberto (somente liderança)')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('observacao')
    .setDescription('Gerencia a lista de observação — cobra ações independente do cargo (somente liderança)')
    .addSubcommand(sub =>
      sub.setName('adicionar')
        .setDescription('Coloca um membro em observação')
        .addUserOption(opt =>
          opt.setName('membro')
            .setDescription('Membro a colocar em observação')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('remover')
        .setDescription('Remove um membro da observação')
        .addUserOption(opt =>
          opt.setName('membro')
            .setDescription('Membro a remover da observação')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('listar')
        .setDescription('Lista quem está em observação no momento'))
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('enviar')
    .setDescription('Envia uma ação para avaliação, vinculando à pendência correspondente')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('relatorios')
    .setDescription('Mostra o relatório da semana atual com métricas de ações')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('historico')
    .setDescription('Mostra o histórico completo (totais) de ações desde sempre')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('ranking-semanal')
    .setDescription('Mostra o ranking da semana atual por ações, vitórias e derrotas')
    .setContexts(CONTEXTS),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking geral (período completo) por ações, vitórias e derrotas')
    .setContexts(CONTEXTS),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('🔄 Registrando comandos slash GLOBAIS (guild + DM)...');

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );

    console.log('✅ Comandos globais registrados com sucesso!');
    console.log('⏳ Pode levar até 1h para aparecer em todo lugar (cache do Discord).');
    console.log('🧹 Limpando comandos antigos específicos da guild...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: [] },
    );
    console.log('✅ Comandos antigos da guild removidos (agora só os globais valem).');

  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err);
  }
})();