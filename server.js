const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const mongoose = require('mongoose');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const ADMIN_USER = process.env.ADMIN_USER || "FreeZeeHost";
const ADMIN_PASS = process.env.ADMIN_PASS || "FreeZeeHost12_";
const MONGODB_URI = process.env.MONGODB_URI;

let StatsModel;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI).then(() => console.log("🍃 DB Connected")).catch(e => console.error(e));
    const schema = new mongoose.Schema({ key: { type: String, default: 'main_config' }, data: Object });
    StatsModel = mongoose.models.Stats || mongoose.model('Stats', schema);
}

let pteroConfig = { 
    url: '', key: '', client_key: '', 
    smtp_user: '', smtp_pass: '', smtp_from: '', 
    location: 1, nest: 1, egg: 15, 
    blacklist: [], customerCounter: 1, totalEarnings: 0, totalVisitors: 0,
    active_gateway: 'manual', pakasir_key: '', pakasir_slug: '', wa_admin: '6285102360656',
    do_token: '', linode_token: ''
};

async function saveAllData() {
    if (MONGODB_URI && StatsModel) {
        await StatsModel.findOneAndUpdate({ key: 'main_config' }, { data: pteroConfig }, { upsert: true });
    }
}

async function loadAllData() {
    if (MONGODB_URI && StatsModel) {
        const doc = await StatsModel.findOne({ key: 'main_config' });
        if (doc) pteroConfig = { ...pteroConfig, ...doc.data };
    }
}
loadAllData();

// --- ROUTES ---
const orderMemory = new Map();

app.get('/api/stats/visit', async (req, res) => {
    pteroConfig.totalVisitors++; await saveAllData();
    res.json({ total: pteroConfig.totalVisitors });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.user === ADMIN_USER && req.body.pass === ADMIN_PASS) return res.json({ status: 'success', token: Buffer.from(ADMIN_PASS).toString('base64') });
    res.status(401).json({ status: 'error' });
});

app.get('/api/admin/config', (req, res) => {
    res.json({ config: pteroConfig, stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors } });
});

app.post('/api/admin/settings', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    try {
        const { ...config } = req.body;
        pteroConfig = { ...pteroConfig, ...config };
        await saveAllData(); res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/api/check-services', async (req, res) => {
    const results = { ptero: 'offline', do: 'offline', linode: 'offline' };
    
    // 1. PTERODACTYL CHECK (Hard Check)
    try {
        if (pteroConfig.url && pteroConfig.key) {
            const r = await axios.get(`${pteroConfig.url}/api/application/nodes`, { 
                headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' },
                timeout: 4000 
            });
            if (r.status === 200) results.ptero = 'online';
        }
    } catch (e) { results.ptero = 'offline'; }

    // 2. DIGITAL OCEAN CHECK (Token Check)
    try {
        if (pteroConfig.do_token) {
            const r = await axios.get('https://api.digitalocean.com/v2/account', { 
                headers: { 'Authorization': `Bearer ${pteroConfig.do_token}` },
                timeout: 4000 
            });
            if (r.status === 200) results.do = 'online';
        }
    } catch (e) { results.do = 'offline'; }

    // 3. LINODE CHECK (API Check)
    try {
        if (pteroConfig.linode_token) {
            const r = await axios.get('https://api.linode.com/v4/profile', { 
                headers: { 'Authorization': `Bearer ${pteroConfig.linode_token}` },
                timeout: 4000 
            });
            if (r.status === 200) results.linode = 'online';
        }
    } catch (e) { results.linode = 'offline'; }

    res.json({ 
        services: results,
        stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors },
        active_gateway: pteroConfig.active_gateway 
    });
});

app.post('/api/checkout', (req, res) => {
    const { nominal, email, whatsapp, package_name, nest_id, egg_id } = req.body;
    const orderId = 'FZH-' + Date.now();
    orderMemory.set(orderId, { amount: nominal, email, whatsapp, package_name, nest_id, egg_id, status: 'pending' });
    const host = req.get('host');
    const returnUrl = `https://${host}/status.html?order_id=${orderId}`;

    if (pteroConfig.active_gateway === 'pakasir') {
        res.json({ status: 'success', checkout_url: `https://app.pakasir.com/pay/${pteroConfig.pakasir_slug}/${nominal}?order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}` });
    } else {
        res.json({ status: 'success', checkout_url: `https://wa.me/${pteroConfig.wa_admin}?text=Beli_${package_name}` });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/Dev.html', (req, res) => res.sendFile(path.join(__dirname, 'Dev.html')));
app.get('/order-panel.html', (req, res) => res.sendFile(path.join(__dirname, 'order-panel.html')));
app.get('/order-vps.html', (req, res) => res.sendFile(path.join(__dirname, 'order-vps.html')));
app.get('/status.html', (req, res) => res.sendFile(path.join(__dirname, 'status.html')));

if (process.env.NODE_ENV !== 'production') app.listen(3000);
module.exports = app;