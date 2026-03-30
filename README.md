# 📋 Discord Relatório Bot

Bot que gera relatórios de ação em imagem via formulário no Discord.

## Fluxo

1. Usuário digita `/relatorio` no servidor
2. Abre um modal (1/2) com campos: Data/Ação, Piloto, Resultado, Spots, Calls
3. Ao submeter, abre o modal (2/2): Ângulos, Comportamento, Pontos de Melhoria, Pontos Negativos
4. Bot gera uma imagem com o relatório formatado e posta no canal configurado

---

## Setup

### 1. Criar o bot no Discord

1. Acesse [discord.com/developers/applications](https://discord.com/developers/applications)
2. Clique em **New Application** → dê um nome
3. Vá em **Bot** → clique em **Add Bot**
4. Em **Bot → Token**, clique em **Reset Token** e copie o token
5. Em **Bot → Privileged Gateway Intents**, ative **Server Members Intent** e **Message Content Intent**
6. Vá em **OAuth2 → URL Generator**:
   - Scopes: `bot` + `applications.commands`
   - Bot Permissions: `Send Messages` + `Attach Files`
   - Copie o link gerado e use para convidar o bot ao servidor

### 2. Configurar o projeto

```bash
# Clonar / baixar os arquivos
# Instalar dependências
npm install

# Copiar o arquivo de variáveis de ambiente
cp .env.example .env
```

Edite o `.env` com seus valores:

```env
BOT_TOKEN=...        # Token do bot
CLIENT_ID=...        # Application ID
GUILD_ID=...         # ID do servidor
REPORT_CHANNEL_ID=...# ID do canal onde os relatórios serão postados
```

> Para obter os IDs: ative o **Modo Desenvolvedor** em Configurações do Discord → Avançado, depois clique direito em qualquer servidor/canal → Copiar ID.

### 3. Registrar o slash command

Execute isso **uma vez** para registrar o `/relatorio` no servidor:

```bash
npm run deploy
```

### 4. Iniciar o bot

```bash
npm start
# ou, para desenvolvimento com auto-reload:
npm run dev
```

---

## Deploy no Railway

1. Crie um projeto em [railway.app](https://railway.app)
2. Conecte ao repositório GitHub (ou faça upload dos arquivos)
3. Adicione as variáveis de ambiente no painel do Railway (mesmas do `.env`)
4. O Railway detecta o `package.json` automaticamente e executa `npm start`

> **Nota:** O pacote `canvas` precisa de dependências nativas. No Railway isso é instalado automaticamente. Se usar outro serviço, verifique se `cairo`, `pango` e `libjpeg` estão disponíveis no ambiente.

---

## Estrutura

```
discord-relatorio-bot/
├── bot.js           # Lógica principal do bot (comandos + modais)
├── generateImage.js # Geração da imagem do relatório com canvas
├── deploy.js        # Script para registrar o slash command (rodar uma vez)
├── package.json
├── .env.example
└── README.md
```
