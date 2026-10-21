const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let sock;
let qrCodeData = '';
let connectionStatus = 'disconnected';
let pairingCode = '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Chrome')
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'qr_ready';
            console.log('⚡ [TEAM TARSIUS] QR Code Baru Siap Dipindai!');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrCodeData = '';
            pairingCode = '';
            console.log(`❌ [TEAM TARSIUS] Koneksi Terputus (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeData = '';
            pairingCode = '';
            console.log('✅ [TEAM TARSIUS] WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Endpoint: Check Status & QR
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCodeData,
        pairingCode: pairingCode
    });
});

// Endpoint: Request Pairing Code
app.post('/request-pairing', async (req, res) => {
    let { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Nomor WhatsApp wajib diisi!' });

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (!phoneNumber.startsWith('62')) {
        return res.status(400).json({ error: 'Format nomor wajib diawali 62...' });
    }

    try {
        if (!sock || connectionStatus === 'disconnected') {
            await connectToWhatsApp();
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!sock.authState.creds.registered) {
            let code = await sock.requestPairingCode(phoneNumber);
            pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
            return res.json({ success: true, pairingCode: pairingCode });
        } else {
            return res.status(400).json({ error: 'WhatsApp sudah terhubung sebelumnya!' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil kode pairing: ' + err.message });
    }
});

// Endpoint: Reset Session
app.post('/refresh-session', async (req, res) => {
    try {
        if (sock) {
            try { await sock.logout(); } catch(e){}
            try { sock.end(undefined); } catch(e){}
        }
        
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }

        qrCodeData = '';
        pairingCode = '';
        connectionStatus = 'disconnected';

        setTimeout(() => connectToWhatsApp(), 1000);
        res.json({ success: true, message: 'Sesi berhasil dibersihkan. Memuat ulang...' });
    } catch (err) {
        res.status(500).json({ error: 'Gagal reset sesi: ' + err.message });
    }
});

// Endpoint: Send Single Message Blast
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (connectionStatus !== 'connected') return res.status(400).json({ error: 'WhatsApp belum terhubung!' });

    try {
        const cleanNumber = number.replace(/[^0-9]/g, '');
        const formattedNumber = `${cleanNumber}@s.whatsapp.net`;
        await sock.sendMessage(formattedNumber, { text: message });
        res.json({ success: true, message: 'Pesan terkirim!' });
    } catch (err) {
        res.status(500).json({ error: 'Gagal kirim: ' + err.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥 TEAM TARSIUS BLAST v4.0 Active on http://localhost:${PORT}`);
    connectToWhatsApp();
});
