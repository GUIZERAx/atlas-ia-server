// ============================================================
// ATLAS IA — Servidor Telegram Bot
// Gerencia usuários e envia sinais para todos os aprovados
// ============================================================

const express    = require('express')
const bodyParser = require('body-parser')
const axios      = require('axios')
const fs         = require('fs')

const app  = express()
app.use(bodyParser.json())

// ── CONFIG — preencha com seus dados ──
const BOT_TOKEN  = process.env.BOT_TOKEN   // Token do BotFather — coloca no Railway
const ADMIN_ID   = '7609371552'            // Seu chat_id já configurado
const PORT       = process.env.PORT || 3000
const API_SECRET = process.env.API_SECRET  // Senha secreta — coloca no Railway
// ──────────────────────────────────────

const DB_FILE = 'usuarios.json'

// ── Banco de dados simples em JSON ──
function lerDB() {
    try {
        if (!fs.existsSync(DB_FILE)) return { aprovados: {}, pendentes: {} }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    } catch(e) {
        return { aprovados: {}, pendentes: {} }
    }
}

function salvarDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// ── Telegram: enviar mensagem ──
async function enviarMsg(chatId, texto, opts) {
    try {
        await axios.post('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
            chat_id:    chatId,
            text:       texto,
            parse_mode: 'HTML',
            ...opts
        })
    } catch(e) {
        console.error('[Bot] Erro ao enviar msg para', chatId, e.message)
    }
}

// ── Telegram: broadcast para todos aprovados ──
async function broadcast(texto) {
    var db = lerDB()
    var ids = Object.keys(db.aprovados)
    console.log('[Bot] Broadcast para', ids.length, 'usuários')
    for (var i = 0; i < ids.length; i++) {
        await enviarMsg(ids[i], texto)
        // Pequeno delay para não bater no rate limit do Telegram
        await new Promise(r => setTimeout(r, 50))
    }
}

// ── Formatar mensagem de sinal ──
function formatarSinal(dados) {
    var fase     = dados.fase     || ''
    var nome     = dados.nome     || ''
    var gatilho  = dados.gatilho  || ''
    var numeros  = dados.numeros  || []
    var acertos  = dados.acertos  || 0
    var erros    = dados.erros    || 0
    var total    = acertos + erros
    var taxa     = total > 0 ? Math.round(acertos / total * 100) : 0

    var VERMELHOS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]

    if (fase === 'apostando') {
        var bolinhas = numeros.map(function(n) {
            var num = parseInt(n)
            var emoji = num === 0 ? '🟢' : VERMELHOS.indexOf(num) !== -1 ? '🔴' : '⚫'
            return emoji + ' <b>' + n + '</b>'
        }).join('  ')

        return '🚀 <b>APOSTE AGORA!</b>\n\n' +
               '🎯 <b>' + nome + '</b>\n' +
               '🔑 Gatilho: <code>' + gatilho + '</code>\n\n' +
               '💰 <b>Números:</b>\n' + bolinhas + '\n\n' +
               '📊 Sessão: ✅ <b>' + acertos + '</b>  ❌ <b>' + erros + '</b>  📈 <b>' + taxa + '%</b>'
    }

    if (fase === 'contando') {
        return '🟠 <b>ATENÇÃO — Gatilho detectado!</b>\n\n' +
               '🎯 <b>' + nome + '</b>\n' +
               '🔑 Gatilho: <code>' + gatilho + '</code>\n\n' +
               '⏳ Aguardando confirmação para entrar...'
    }

    if (fase === 'ganhou') {
        return '✅ <b>GANHOU!</b>  Número: <b>' + (dados.numero || '') + '</b>\n' +
               '📊 ✅ <b>' + acertos + '</b>  ❌ <b>' + erros + '</b>  📈 <b>' + taxa + '%</b>'
    }

    if (fase === 'perdeu') {
        return '❌ <b>PERDEU!</b>  Número: <b>' + (dados.numero || '') + '</b>\n' +
               '📊 ✅ <b>' + acertos + '</b>  ❌ <b>' + erros + '</b>  📈 <b>' + taxa + '%</b>'
    }

    if (fase === 'gale') {
        return '⚡ <b>GALE ' + (dados.gale||1) + '</b> — Saiu: <b>' + (dados.numero||'') + '</b>\n' +
               'Mantendo aposta nos mesmos números'
    }

    return ''
}

// ============================================================
// ROTAS
// ============================================================

// ── Webhook do Telegram (recebe mensagens dos usuários) ──
app.post('/webhook', async function(req, res) {
    res.sendStatus(200)
    var update = req.body
    if (!update.message) return

    var msg      = update.message
    var chatId   = String(msg.chat.id)
    var username = msg.from.username ? '@' + msg.from.username : msg.from.first_name
    var texto    = (msg.text || '').trim()
    var db       = lerDB()

    console.log('[Bot] Mensagem de', username, '(' + chatId + '):', texto)

    // ── /start ──
    if (texto === '/start') {
        if (db.aprovados[chatId]) {
            await enviarMsg(chatId,
                '✅ Você já está <b>aprovado</b>!\n\n' +
                'Aguarde os sinais do Atlas IA automaticamente aqui.')
            return
        }
        db.pendentes[chatId] = { username: username, nome: msg.from.first_name, data: new Date().toISOString() }
        salvarDB(db)
        await enviarMsg(chatId,
            '👋 Olá, <b>' + msg.from.first_name + '</b>!\n\n' +
            'Seu acesso está <b>pendente de aprovação</b>.\n' +
            'Assim que for aprovado você receberá os sinais automaticamente.')
        // Notifica o admin
        await enviarMsg(ADMIN_ID,
            '🔔 <b>Novo usuário aguardando aprovação:</b>\n\n' +
            '👤 ' + username + '\n' +
            '🆔 Chat ID: <code>' + chatId + '</code>\n\n' +
            'Para aprovar: /aprovar ' + chatId + '\n' +
            'Para recusar: /recusar ' + chatId)
        return
    }

    // ── Comandos de admin (só o ADMIN_ID pode usar) ──
    if (chatId !== String(ADMIN_ID)) {
        if (!db.aprovados[chatId]) {
            await enviarMsg(chatId, '⏳ Seu acesso ainda está <b>pendente de aprovação</b>.')
        }
        return
    }

    // /aprovar <chatId>
    if (texto.startsWith('/aprovar')) {
        var alvo = texto.split(' ')[1]
        if (!alvo) { await enviarMsg(chatId, 'Use: /aprovar <chat_id>'); return }
        db = lerDB()
        var info = db.pendentes[alvo] || { username: alvo, nome: alvo }
        db.aprovados[alvo] = info
        delete db.pendentes[alvo]
        salvarDB(db)
        await enviarMsg(chatId, '✅ Usuário <b>' + info.username + '</b> aprovado!')
        await enviarMsg(alvo,
            '🎉 <b>Acesso aprovado!</b>\n\n' +
            'Você agora vai receber os sinais do Atlas IA em tempo real aqui.\n' +
            'Bons trades! 🚀')
        return
    }

    // /recusar <chatId>
    if (texto.startsWith('/recusar')) {
        var alvoR = texto.split(' ')[1]
        if (!alvoR) { await enviarMsg(chatId, 'Use: /recusar <chat_id>'); return }
        db = lerDB()
        var infoR = db.pendentes[alvoR] || db.aprovados[alvoR] || { username: alvoR }
        delete db.pendentes[alvoR]
        delete db.aprovados[alvoR]
        salvarDB(db)
        await enviarMsg(chatId, '🗑 Usuário <b>' + infoR.username + '</b> removido.')
        await enviarMsg(alvoR, '❌ Seu acesso foi removido.')
        return
    }

    // /remover <chatId>  (alias de recusar para aprovados)
    if (texto.startsWith('/remover')) {
        var alvoRm = texto.split(' ')[1]
        if (!alvoRm) { await enviarMsg(chatId, 'Use: /remover <chat_id>'); return }
        db = lerDB()
        var infoRm = db.aprovados[alvoRm] || { username: alvoRm }
        delete db.aprovados[alvoRm]
        salvarDB(db)
        await enviarMsg(chatId, '🗑 Usuário <b>' + infoRm.username + '</b> removido.')
        return
    }

    // /lista — lista aprovados e pendentes
    if (texto === '/lista') {
        db = lerDB()
        var aprov = Object.entries(db.aprovados)
        var pend  = Object.entries(db.pendentes)
        var resposta = '👥 <b>USUÁRIOS</b>\n\n'
        resposta += '✅ <b>Aprovados (' + aprov.length + '):</b>\n'
        if (aprov.length === 0) resposta += '  Nenhum\n'
        aprov.forEach(function(e) { resposta += '  • ' + e[1].username + ' (<code>' + e[0] + '</code>)\n' })
        resposta += '\n⏳ <b>Pendentes (' + pend.length + '):</b>\n'
        if (pend.length === 0) resposta += '  Nenhum\n'
        pend.forEach(function(e) { resposta += '  • ' + e[1].username + ' (<code>' + e[0] + '</code>)\n' })
        await enviarMsg(chatId, resposta)
        return
    }

    // /ajuda
    if (texto === '/ajuda' || texto === '/help') {
        await enviarMsg(chatId,
            '📋 <b>COMANDOS ADMIN</b>\n\n' +
            '/lista — Ver todos usuários\n' +
            '/aprovar <id> — Aprovar usuário\n' +
            '/recusar <id> — Recusar pendente\n' +
            '/remover <id> — Remover aprovado\n' +
            '/status — Status do servidor\n' +
            '/broadcast <msg> — Enviar mensagem manual para todos')
        return
    }

    // /status
    if (texto === '/status') {
        db = lerDB()
        await enviarMsg(chatId,
            '🟢 <b>Servidor online</b>\n\n' +
            '👥 Aprovados: <b>' + Object.keys(db.aprovados).length + '</b>\n' +
            '⏳ Pendentes: <b>' + Object.keys(db.pendentes).length + '</b>')
        return
    }

    // /broadcast <mensagem>
    if (texto.startsWith('/broadcast ')) {
        var msgBroad = texto.replace('/broadcast ', '')
        await broadcast('📢 <b>Mensagem do admin:</b>\n\n' + msgBroad)
        await enviarMsg(chatId, '✅ Mensagem enviada para todos os aprovados.')
        return
    }
})

// ── Rota que a extensão chama para enviar sinais ──
app.post('/sinal', async function(req, res) {
    // Verificar autenticação
    if (req.headers['x-api-secret'] !== API_SECRET) {
        return res.status(401).json({ erro: 'Não autorizado' })
    }

    var dados = req.body
    console.log('[Sinal recebido]', dados.fase, dados.nome || '')

    var msg = formatarSinal(dados)
    if (!msg) return res.json({ ok: true, enviado: false })

    await broadcast(msg)
    res.json({ ok: true, enviado: true })
})

// ── Health check ──
app.get('/', function(req, res) {
    res.json({ status: 'Atlas IA Server online' })
})

// ── Configurar webhook do Telegram ──
app.get('/setup-webhook', async function(req, res) {
    var url = req.query.url
    if (!url) return res.json({ erro: 'Passe ?url=https://seu-servidor.railway.app' })
    try {
        var r = await axios.post('https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook', {
            url: url + '/webhook'
        })
        res.json(r.data)
    } catch(e) {
        res.json({ erro: e.message })
    }
})

app.listen(PORT, function() {
    console.log('[Atlas IA Server] Rodando na porta', PORT)
})
