const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- PENGATURAN KEAMANAN ---
const ADMIN_USER = process.env.ADMIN_USER || "FreeZeeHost";
const ADMIN_PASS = process.env.ADMIN_PASS || "FreeZeeHost12_";
const MONGODB_URI = process.env.MONGODB_URI;

// --- DATABASE CONNECTION ---
let StatsModel;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log("🍃 MongoDB Connected"))
        .catch(e => console.error("DB Error"));
    const schema = new mongoose.Schema({ key: { type: String, default: 'main_config' }, data: Object });
    StatsModel = mongoose.models.Stats || mongoose.model('Stats', schema);
}

let pteroConfig = { 
    url: '', key: '', client_key: '', 
    smtp_user: '', smtp_pass: '', smtp_from: '', 
    location: 1, nest: 1, egg: 15, 
    blacklist: [], customerCounter: 1, totalEarnings: 0, totalVisitors: 0,
    active_gateway: 'manual',
    pakasir_key: 'cp15yjTyKR6ZhXAdizVFc1EvX72XuFfe',
    pakasir_slug: 'freezeehost',
    ok_merchant_code: '',
    ok_api_key: '',
    wa_admin: '6285102360656'
};

async function saveAllData() {
    if (MONGODB_URI && StatsModel) {
        try { await StatsModel.findOneAndUpdate({ key: 'main_config' }, { data: pteroConfig }, { upsert: true }); } catch (e) {}
    }
}

async function loadAllData() {
    if (MONGODB_URI && StatsModel) {
        try {
            const doc = await StatsModel.findOne({ key: 'main_config' });
            if (doc) { pteroConfig = { ...pteroConfig, ...doc.data }; return; }
        } catch (e) {}
    }
}
loadAllData();

// --- MIDDLEWARES ---
app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (pteroConfig.blacklist && pteroConfig.blacklist.includes(clientIp)) return res.status(403).json({ status: 'error', message: 'Blocked' });
    next();
});

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const orderMemory = new Map();

// --- API ROUTES ---

app.get('/api/stats/visit', async (req, res) => {
    pteroConfig.totalVisitors = (pteroConfig.totalVisitors || 0) + 1;
    await saveAllData();
    res.json({ total: pteroConfig.totalVisitors });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json({ status: 'success', token: Buffer.from(ADMIN_PASS).toString('base64') });
    res.status(401).json({ status: 'error' });
});

app.get('/api/admin/config', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    res.json({ config: pteroConfig, stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors } });
});

app.post('/api/admin/settings', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    try {
        const { stats_buyers, stats_earnings, stats_visitors, ...config } = req.body;
        pteroConfig = { 
            ...pteroConfig, ...config, 
            customerCounter: parseInt(stats_buyers) + 1, 
            totalEarnings: parseInt(stats_earnings),
            totalVisitors: parseInt(stats_visitors || pteroConfig.totalVisitors)
        };
        await saveAllData();
        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/api/check-services', async (req, res) => {
    const results = { ptero: 'offline', do: 'offline', linode: 'offline' };
    try {
        if (pteroConfig.url && pteroConfig.key) {
            const r = await axios.get(`${pteroConfig.url}/api/application/nodes`, { headers: { 'Authorization': `Bearer ${pteroConfig.key}` }, timeout: 3000 });
            if (r.status === 200) results.ptero = 'online';
        }
    } catch (e) {}
    res.json({ 
        status: results.ptero, services: results,
        stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors },
        active_gateway: pteroConfig.active_gateway
    });
});

app.post('/api/checkout', (req, res) => {
    const { nominal, email, whatsapp, package_name, nest_id, egg_id } = req.body;
    const orderId = 'FZH-' + Date.now();
    orderMemory.set(orderId, { amount: nominal, email, whatsapp, package: package_name, nest_id, egg_id, status: 'pending' });
    
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const returnUrl = `${protocol}://${host}/status.html?order_id=${orderId}`;

    if (pteroConfig.active_gateway === 'pakasir') {
        const url = `https://app.pakasir.com/pay/${pteroConfig.pakasir_slug}/${nominal}?order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}`;
        return res.json({ status: 'success', checkout_url: url });
    } 
    else {
        const text = `Halo Admin, saya ingin beli:\n\n*Paket:* ${package_name}\n*Nominal:* Rp ${nominal.toLocaleString('id-ID')}\n*Order ID:* ${orderId}\n*Email:* ${email}\n\nMohon instruksi pembayarannya.`;
        const url = `https://wa.me/${pteroConfig.wa_admin}?text=${encodeURIComponent(text)}`;
        return res.json({ status: 'success', checkout_url: url });
    }
});

// Explicit Static File Delivery for Vercel
const serveFile = (file) => (req, res) => res.sendFile(path.join(process.cwd(), file));

app.get('/', serveFile('index.html'));
app.get('/index.html', serveFile('index.html'));
app.get('/Dev.html', serveFile('Dev.html'));
app.get('/dev.html', serveFile('Dev.html')); // Case insensitive alias
app.get('/order-panel.html', serveFile('order-panel.html'));
app.get('/order-vps.html', serveFile('order-vps.html'));
app.get('/status.html', serveFile('status.html'));

// Fallback static
app.use(express.static(path.join(__dirname)));

if (process.env.NODE_ENV !== 'production') app.listen(3000, () => console.log(`🚀 Ready`));
module.exports = app;