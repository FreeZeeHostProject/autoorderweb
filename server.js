const express = require('express');
const cors = require('cors');
const axios = require('axios');
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

// --- API ROUTES ---

app.get('/api/stats/visit', async (req, res) => {
    pteroConfig.totalVisitors = (pteroConfig.totalVisitors || 0) + 1;
    await saveAllData();
    res.json({ total: pteroConfig.totalVisitors });
});

app.post('/api/admin/login', (req, res) => {
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
    const results = { ptero: 'offline' };
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
    const { nominal, email, whatsapp, package_name } = req.body;
    const orderId = 'FZH-' + Date.now();
    const returnUrl = `https://${req.get('host')}/status.html?order_id=${orderId}`;

    if (pteroConfig.active_gateway === 'pakasir') {
        const url = `https://app.pakasir.com/pay/${pteroConfig.pakasir_slug}/${nominal}?order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}`;
        return res.json({ status: 'success', checkout_url: url });
    } 
    else {
        const text = `Halo Admin, beli: ${package_name} - Rp ${nominal.toLocaleString('id-ID')}`;
        const url = `https://wa.me/${pteroConfig.wa_admin}?text=${encodeURIComponent(text)}`;
        return res.json({ status: 'success', checkout_url: url });
    }
});

// STATIC FILE SERVING
const sendFile = (file) => (req, res) => res.sendFile(path.join(__dirname, file));

app.get('/', sendFile('index.html'));
app.get('/index.html', sendFile('index.html'));
app.get('/Dev.html', sendFile('Dev.html'));
app.get('/dev', sendFile('Dev.html'));
app.get('/order-panel.html', sendFile('order-panel.html'));
app.get('/order-vps.html', sendFile('order-vps.html'));
app.get('/status.html', sendFile('status.html'));

// EXPORT FOR VERCEL
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('🚀 Local: http://localhost:3000'));
}
module.exports = app;