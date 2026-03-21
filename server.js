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

// ── Roda europeia para agrupar vizinhos ──
var RODA = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26]
var VERMELHOS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]

function bolinha(n) {
    var num = parseInt(n)
    var e = num === 0 ? '🟢' : VERMELHOS.indexOf(num) !== -1 ? '🔴' : '⚫'
    return e + '<b>' + n + '</b>'
}

function vizinhosRoda(num, nViz) {
    var idx = RODA.indexOf(parseInt(num))
    if (idx === -1) return [num]
    var g = []
    for (var d = -nViz; d <= nViz; d++) {
        g.push(String(RODA[(idx + d + RODA.length) % RODA.length]))
    }
    return g
}

// Detecta o dica de setor para estratégias setoriais
function dicaSetor(nome) {
    var n = (nome||'').toUpperCase()
    if (n.indexOf('TQ→V') !== -1 || n.indexOf('TQ-V') !== -1) return '👆 Clique <b>VOISINS</b> na race track'
    if (n.indexOf('VQ→T') !== -1 || n.indexOf('VQ-T') !== -1) return '👆 Clique <b>TIER</b> na race track'
    if (n.indexOf('ZERO DOM') !== -1) return '👆 Clique <b>JEU ZERO</b> na race track'
    if (n.indexOf('ORPH') !== -1) return '👆 Clique <b>ORPHELINS</b> na race track'
    return ''
}

// Agrupa números em grupos de vizinhos na roda
// Lógica: igual ao display da extensão — centro + vizinhos que TAMBÉM estão na entrada
function agruparNumerosRoda(numeros) {
    var entradaSet = {}
    numeros.forEach(function(n) { entradaSet[String(n)] = true })

    // Ordena por posição na roda
    var comIdx = numeros.map(function(n) {
        return { n: String(n), idx: RODA.indexOf(parseInt(n)) }
    }).filter(function(x) { return x.idx !== -1 })
    .sort(function(a, b) { return a.idx - b.idx })

    var usados = {}
    var grupos = []

    comIdx.forEach(function(x) {
        if (usados[x.n]) return
        var idx = x.idx
        var esq = String(RODA[(idx - 1 + RODA.length) % RODA.length])
        var dir = String(RODA[(idx + 1) % RODA.length])
        var esqNaEntrada = entradaSet[esq] && !usados[esq]
        var dirNaEntrada = entradaSet[dir] && !usados[dir]

        if (esqNaEntrada && dirNaEntrada) {
            // grupo de 3: esq · centro · dir
            grupos.push([esq, x.n, dir])
            usados[esq] = true; usados[x.n] = true; usados[dir] = true
        } else if (esqNaEntrada) {
            // grupo de 2: esq · centro
            grupos.push([esq, x.n])
            usados[esq] = true; usados[x.n] = true
        } else if (dirNaEntrada) {
            // grupo de 2: centro · dir
            grupos.push([x.n, dir])
            usados[x.n] = true; usados[dir] = true
        } else {
            // isolado
            grupos.push([x.n])
            usados[x.n] = true
        }
    })
    return grupos
}

// ── Formatar mensagem de sinal ──
// ── Detecta tipo de estratégia e retorna tag + emoji ──
function detectarTipo(nome) {
    var n = (nome || '').toLowerCase()
        .replace(/[áàãâä]/g,'a').replace(/[éèêë]/g,'e')
        .replace(/[íìîï]/g,'i').replace(/[óòõôö]/g,'o')
        .replace(/[úùûü]/g,'u').replace(/[ç]/g,'c')

    // Clássicas
    if (n.indexOf('elite 2x')     !== -1) return { tag: '[🔥 ELITE 2X]',      emoji: '🔥', tipo: 'classica' }
    if (n.indexOf('quarta dim')   !== -1 ||
        n.indexOf('dimensao')     !== -1) return { tag: '[🌀 QUARTA DIM]',     emoji: '🌀', tipo: 'classica' }
    if (n.indexOf('formula 5x')  !== -1) return { tag: '[⚡ FÓRMULA 5X]',     emoji: '⚡', tipo: 'classica' }
    if (n.indexOf('padrao black') !== -1 ||
        (n.indexOf('black') !== -1 && n.indexOf('padrao') !== -1))
                                          return { tag: '[⬛ PADRÃO BLACK]',   emoji: '⬛', tipo: 'classica' }
    if (n.indexOf('quadrante')    !== -1) return { tag: '[◻️ QUADRANTES]',     emoji: '◻️', tipo: 'classica' }
    // Modo Sinais (verde+fora)
    if (n.indexOf('sinal') !== -1 && n.indexOf(' g') !== -1)
                                          return { tag: '[🔵 SINAL V+F]',      emoji: '🔵', tipo: 'sinal' }
    // PDFs
    if (n.indexOf('invert')       !== -1) return { tag: '[🔄 INVERTIDOS]',     emoji: '🔄', tipo: 'pdf' }
    if (n.indexOf('fixo')         !== -1) return { tag: '[📌 FIXOS]',          emoji: '📌', tipo: 'pdf' }
    if (n.indexOf('se chamam')    !== -1) return { tag: '[🧲 SE CHAMAM]',      emoji: '🧲', tipo: 'pdf' }
    if (n.indexOf('poucas fichas')!== -1) return { tag: '[🎯 POUCAS FICHAS]',  emoji: '🎯', tipo: 'pdf' }
    if (n.indexOf('gatilho')      !== -1) return { tag: '[⚡ GATILHO]',        emoji: '⚡', tipo: 'pdf' }
    if (n.indexOf('puxam')        !== -1) return { tag: '[↕️ SE PUXAM]',       emoji: '↕️', tipo: 'pdf' }
    // Setoriais
    if (n.indexOf('vq') !== -1 || n.indexOf('tq') !== -1)
                                          return { tag: '[🔄 SETOR]',          emoji: '🔄', tipo: 'setor' }
    if (n.indexOf('zero dom')     !== -1) return { tag: '[🟢 ZERO DOM]',       emoji: '🟢', tipo: 'setor' }
    if (n.indexOf('orph')         !== -1) return { tag: '[👻 ÓRFÃOS]',         emoji: '👻', tipo: 'setor' }

    return { tag: '', emoji: '🎯', tipo: 'outro' }
}

function formatarSinal(dados) {
    var fase    = dados.fase    || ''
    var nome    = dados.nome    || ''
    var gatilho = dados.gatilho || ''
    var numeros = dados.numeros || []
    var acertos = dados.acertos || 0
    var erros   = dados.erros   || 0
    var total   = acertos + erros
    var taxa    = total > 0 ? Math.round(acertos / total * 100) : 0
    var mesa    = dados.mesa ? dados.mesa + '\n' : ''
    var tipo    = detectarTipo(nome)

    function placar() {
        return '📊 ✅ <b>' + acertos + '</b>  ❌ <b>' + erros + '</b>  📈 <b>' + taxa + '%</b>'
    }

    function corNum(n) {
        var num = parseInt(n)
        if (num === 0) return '🟢'
        return VERMELHOS.indexOf(num) !== -1 ? '🔴' : '⚫'
    }

    // ── APOSTANDO ──────────────────────────────────────────────
    if (fase === 'apostando') {
        var grupos     = agruparNumerosRoda(numeros)
        var totalNums  = numeros.length
        var dica       = dicaSetor(nome)

        var linhasGrupos = grupos.map(function(g) {
            return g.map(function(n) { return corNum(n) + '<b>' + n + '</b>' }).join(' · ')
        }).join('\n')

        // SINAL (verde+fora): mostra disparador + confirmações do sinal
        if (tipo.tipo === 'sinal') {
            var dispNum = gatilho || nome.replace(/.*G(\d+).*/,'$1')
            return mesa +
                '🚀 <b>APOSTE AGORA!</b> ' + tipo.tag + '\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                '🔵 ' + nome + '\n' +
                '🎯 Disparador: <code>' + dispNum + '</code>  |  💰 ' + totalNums + ' números\n' +
                '✅ Sinal verde+fora confirmado\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                '<b>Alvos Principais + Ocultos:</b>\n' +
                linhasGrupos + '\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                placar()
        }

        // CLÁSSICAS: mostra gatilho + dica da race track
        if (tipo.tipo === 'classica') {
            return mesa +
                '🚀 <b>APOSTE AGORA!</b> ' + tipo.tag + '\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                tipo.emoji + ' ' + nome + '\n' +
                '🔑 Gatilho: <code>' + gatilho + '</code>  |  💰 ' + totalNums + ' números\n' +
                (dica ? '👆 ' + dica.replace('👆 ','') + '\n' : '') +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                linhasGrupos + '\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                placar()
        }

        // PDFs e outros: mostra nome + gatilho
        return mesa +
            '🚀 <b>APOSTE AGORA!</b>' + (tipo.tag ? ' ' + tipo.tag : '') + '\n' +
            '━━━━━━━━━━━━━━━━━━━━━\n' +
            tipo.emoji + ' ' + nome + '\n' +
            '🔑 Gatilho: <code>' + gatilho + '</code>  |  💰 ' + totalNums + ' números\n' +
            '━━━━━━━━━━━━━━━━━━━━━\n' +
            linhasGrupos + '\n' +
            '━━━━━━━━━━━━━━━━━━━━━\n' +
            placar()
    }

    // ── CONTANDO ──────────────────────────────────────────────
    if (fase === 'contando') {
        // SINAL: mostra progresso verde+fora (não envia — aguarda confirmar)
        // CLÁSSICAS: mostra gatilho detectado + aguardando neutro/tend
        if (tipo.tipo === 'sinal') {
            return ''  // Sinais só notificam quando confirmam (apostando)
        }
        if (tipo.tipo === 'classica') {
            return mesa +
                '🟠 <b>GATILHO DETECTADO!</b> ' + tipo.tag + '\n' +
                '━━━━━━━━━━━━━━━━━━━━━\n' +
                tipo.emoji + ' ' + nome + '\n' +
                '🔑 Disparou: <code>' + gatilho + '</code>\n' +
                '⏳ Aguardando neutro + tendência...'
        }
        // PDFs: gatilho detectado, entra no próximo
        return mesa +
            '🟠 <b>GATILHO DETECTADO!</b>' + (tipo.tag ? ' ' + tipo.tag : '') + '\n' +
            tipo.emoji + ' ' + nome + '\n' +
            '🔑 Disparou: <code>' + gatilho + '</code>\n' +
            '⚡ Próximo número = entrada'
    }

    // ── GANHOU ──────────────────────────────────────────────
    if (fase === 'ganhou') {
        return mesa +
            '✅ <b>GANHOU!</b>  ' + corNum(dados.numero||0) + '<b>' + (dados.numero||'') + '</b>\n' +
            (nome ? '<i>' + nome + '</i>\n' : '') +
            placar()
    }

    // ── PERDEU ──────────────────────────────────────────────
    if (fase === 'perdeu') {
        return mesa +
            '❌ <b>PERDEU!</b>  ' + corNum(dados.numero||0) + '<b>' + (dados.numero||'') + '</b>\n' +
            (nome ? '<i>' + nome + '</i>\n' : '') +
            placar()
    }

    // ── GALE ──────────────────────────────────────────────
    if (fase === 'gale') {
        return mesa +
            '⚡ <b>GALE ' + (dados.gale||1) + '</b> — Saiu: ' +
            corNum(dados.numero||0) + '<b>' + (dados.numero||'') + '</b>\n' +
            '🔁 Mantendo aposta'
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
