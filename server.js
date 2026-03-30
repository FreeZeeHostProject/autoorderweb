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

// --- SECURITY ---
const ADMIN_USER = process.env.ADMIN_USER || "FreeZeeHost";
const ADMIN_PASS = process.env.ADMIN_PASS || "FreeZeeHost12_";
const MONGODB_URI = process.env.MONGODB_URI;

// --- DATABASE ---
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
    active_gateway: 'manual',
    pakasir_key: 'cp15yjTyKR6ZhXAdizVFc1EvX72XuFfe',
    pakasir_slug: 'freezeehost',
    ok_merchant_code: '',
    ok_api_key: '',
    wa_admin: '6285102360656',
    do_token: '', // Jangan sampai tertinggal
    linode_token: '' // Jangan sampai tertinggal
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

// --- PTERO HELPERS ---
async function findPterodactylUserByEmail(email) {
    try {
        const response = await axios.get(`${pteroConfig.url}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
            headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' }
        });
        if (response.data.data && response.data.data.length > 0) return { success: true, userId: response.data.data[0].attributes.id };
        return { success: false };
    } catch (e) { return { success: false }; }
}

async function processServerDeployment(orderId, orderData) {
    if (orderData.status === 'completed') return orderData.credentials;
    const currentNumber = pteroConfig.customerCounter++;
    pteroConfig.totalEarnings += orderData.amount;
    await saveAllData();

    if (orderData.nest_id == 0) {
        orderData.status = 'completed';
        return { panel_url: "Manual Setup", username: "Pending", password: "Check WA" };
    }

    const username = `FreeZeeHost${currentNumber}`;
    const password = Math.random().toString(36).slice(-10) + '123!';
    const pteroEmail = `freezeehost${currentNumber}@gmail.com`;

    try {
        let userId;
        const existing = await findPterodactylUserByEmail(orderData.email);
        if (existing.success) userId = existing.userId;
        else {
            const res = await axios.post(`${pteroConfig.url}/api/application/users`, { email: pteroEmail, username: username.toLowerCase(), first_name: "Customer", last_name: username, password }, { headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' } });
            userId = res.data.attributes.id;
        }
        
        let ram = 1024, cpu = 100, disk = 5120;
        const val = parseInt(orderData.package_name);
        if (!isNaN(val)) { ram = val * 1024; cpu = val * 100; disk = val * 5120; }
        if (orderData.package_name.includes('Unlimited')) { ram = 0; cpu = 0; disk = 0; }

        await axios.post(`${pteroConfig.url}/api/application/servers`, {
            name: `Server-${username}`, user: userId, nest: parseInt(orderData.nest_id), egg: parseInt(orderData.egg_id),
            docker_image: "ghcr.io/pterodactyl/yolks:nodejs_20", startup: "node .",
            environment: { "P_SERVER_ALLOCATION_LIMIT": "0", "COMMAND_RUN": "node index.js" },
            limits: { memory: ram, swap: 0, disk: disk, io: 500, cpu: cpu },
            feature_limits: { databases: 1, backups: 1, allocations: 1 },
            deploy: { locations: [pteroConfig.location], dedicated_ip: false, port_range: [] }
        }, { headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' } });

        const creds = { panel_url: pteroConfig.url, username, password };
        orderData.status = 'completed'; orderData.credentials = creds; return creds;
    } catch (e) { throw e; }
}

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
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    res.json({ config: pteroConfig, stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors } });
});

app.post('/api/admin/settings', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    try {
        const { stats_buyers, stats_earnings, stats_visitors, ...config } = req.body;
        pteroConfig = { ...pteroConfig, ...config, customerCounter: parseInt(stats_buyers) + 1, totalEarnings: parseInt(stats_earnings), totalVisitors: parseInt(stats_visitors) };
        await saveAllData(); 
        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/api/check-services', async (req, res) => {
    let status = 'offline';
    try {
        if (pteroConfig.url && pteroConfig.key) {
            const r = await axios.get(`${pteroConfig.url}/api/application/nodes`, { headers: { 'Authorization': `Bearer ${pteroConfig.key}` }, timeout: 2000 });
            if (r.status === 200) status = 'online';
        }
    } catch (e) {}
    res.json({ status, stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings, totalVisitors: pteroConfig.totalVisitors }, active_gateway: pteroConfig.active_gateway });
});

app.post('/api/checkout', (req, res) => {
    const { nominal, email, whatsapp, package_name, nest_id, egg_id } = req.body;
    const orderId = 'FZH-' + Date.now();
    orderMemory.set(orderId, { amount: nominal, email, whatsapp, package_name, nest_id, egg_id, status: 'pending' });
    const returnUrl = `https://${req.get('host')}/status.html?order_id=${orderId}`;

    if (pteroConfig.active_gateway === 'pakasir') {
        res.json({ status: 'success', checkout_url: `https://app.pakasir.com/pay/${pteroConfig.pakasir_slug}/${nominal}?order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}` });
    } else {
        const text = `Halo Admin, saya mau beli ${package_name}. Order ID: ${orderId}`;
        res.json({ status: 'success', checkout_url: `https://wa.me/${pteroConfig.wa_admin}?text=${encodeURIComponent(text)}` });
    }
});

app.get('/api/verify', async (req, res) => {
    const orderId = req.query.order_id;
    const orderData = orderMemory.get(orderId);
    if (!orderData) return res.json({ status: 'error' });
    if (orderData.status === 'completed') return res.json({ status: 'success', credentials: orderData.credentials });
    
    try {
        const checkUrl = `https://app.pakasir.com/api/transactiondetail?project=${pteroConfig.pakasir_slug}&amount=${orderData.amount}&order_id=${orderId}&api_key=${pteroConfig.pakasir_key}`;
        const response = await axios.get(checkUrl);
        if (response.data.transaction?.status === 'completed') {
            const creds = await processServerDeployment(orderId, orderData);
            return res.json({ status: 'success', credentials: creds });
        }
        res.json({ status: 'pending' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/Dev.html', (req, res) => res.sendFile(path.join(__dirname, 'Dev.html')));

if (process.env.NODE_ENV !== 'production') app.listen(3000);
module.exports = app;