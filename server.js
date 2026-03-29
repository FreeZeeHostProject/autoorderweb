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
app.use(express.static(path.join(__dirname)));

const CONFIG_FILE = path.join(__dirname, 'config.json');

// --- PENGATURAN KEAMANAN ---
const ADMIN_USER = process.env.ADMIN_USER || "FreeZeeHost";
const ADMIN_PASS = process.env.ADMIN_PASS || "FreeZeeHost12_";
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY || 'cp15yjTyKR6ZhXAdizVFc1EvX72XuFfe'; 
const PAKASIR_SLUG = process.env.PAKASIR_SLUG || 'freezeehost';
const MONGODB_URI = process.env.MONGODB_URI;

// --- DATABASE CONNECTION ---
let StatsModel;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log("🍃 MongoDB Connected"))
        .catch(e => console.error("DB Connection Error"));
    const schema = new mongoose.Schema({ key: { type: String, default: 'main_config' }, data: Object });
    StatsModel = mongoose.models.Stats || mongoose.model('Stats', schema);
}

let pteroConfig = { 
    url: '', key: '', client_key: '', 
    smtp_user: '', smtp_pass: '', smtp_from: '', 
    location: 1, nest: 1, egg: 15, 
    blacklist: [], customerCounter: 1, totalEarnings: 0,
    do_token: '', linode_token: '' 
};

async function saveAllData() {
    if (MONGODB_URI && StatsModel) {
        try { await StatsModel.findOneAndUpdate({ key: 'main_config' }, { data: pteroConfig }, { upsert: true }); } catch (e) {}
    }
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(pteroConfig, null, 2)); } catch (e) {}
}

async function loadAllData() {
    if (MONGODB_URI && StatsModel) {
        try {
            const doc = await StatsModel.findOne({ key: 'main_config' });
            if (doc) { pteroConfig = { ...pteroConfig, ...doc.data }; return; }
        } catch (e) {}
    }
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE));
            pteroConfig = { ...pteroConfig, ...saved };
        } catch (e) {}
    }
}
loadAllData();

// --- SECURITY MIDDLEWARES ---
app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (pteroConfig.blacklist && pteroConfig.blacklist.includes(clientIp)) return res.status(403).json({ status: 'error', message: 'Blocked' });
    next();
});

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const orderMemory = new Map();

// --- PTERO HELPERS ---
async function findPterodactylUserByEmail(email) {
    try {
        const response = await axios.get(`${pteroConfig.url}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
            headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' }
        });
        if (response.data.data && response.data.data.length > 0) return { success: true, userId: response.data.data[0].attributes.id, username: response.data.data[0].attributes.username };
        return { success: false };
    } catch (e) { return { success: false }; }
}

async function createPterodactylUser(email, username, password) {
    const res = await axios.post(`${pteroConfig.url}/api/application/users`, { email, username: username.toLowerCase(), first_name: "Customer", last_name: username, password }, { headers: { 'Authorization': `Bearer ${pteroConfig.key}`, 'Accept': 'application/json' } });
    return { success: true, userId: res.data.attributes.id };
}

async function processServerDeployment(orderId, orderData) {
    if (orderData.status === 'completed' || orderData.status === 'processing') return orderData.credentials;
    orderData.status = 'processing';
    const currentNumber = pteroConfig.customerCounter++;
    pteroConfig.totalEarnings = (pteroConfig.totalEarnings || 0) + orderData.amount;
    await saveAllData();

    if (orderData.nest_id == 0) {
        if (pteroConfig.smtp_user && pteroConfig.smtp_pass) {
            const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: pteroConfig.smtp_user, pass: pteroConfig.smtp_pass } });
            await transporter.sendMail({
                from: `"${pteroConfig.smtp_from}" <${pteroConfig.smtp_user}>`,
                to: orderData.email,
                subject: 'Pesanan VPS FreeZeeHosting Diterima!',
                html: `<h2>Halo!</h2><p>Pembayaran untuk <b>${orderData.package}</b> telah kami terima.</p><p>Setup manual segera dilakukan oleh admin.</p>`
            }).catch(e => console.error("Email Error"));
        }
        orderData.status = 'completed'; orderData.credentials = { panel_url: "Manual Setup", username: "Pending", password: "Check WA/Email" };
        return orderData.credentials;
    }

    const username = `FreeZeeHost${currentNumber}`;
    const password = Math.random().toString(36).slice(-10) + '123!';
    const pteroEmail = `freezeehost${currentNumber}@gmail.com`;

    try {
        let userId;
        const existing = await findPterodactylUserByEmail(orderData.email);
        if (existing.success) userId = existing.userId;
        else {
            const newUser = await createPterodactylUser(pteroEmail, username, password);
            userId = newUser.userId;
        }
        let ram = 1024, cpu = 100, disk = 5120;
        if (orderData.package.includes('Unlimited')) { ram = 0; cpu = 0; disk = 0; }
        else {
            const val = parseInt(orderData.package);
            if (!isNaN(val)) { ram = val * 1024; cpu = val * 100; disk = val * 5120; }
        }
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
    } catch (e) { orderData.status = 'pending'; throw e; }
}

// --- API ROUTES ---
app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json({ status: 'success', token: Buffer.from(ADMIN_PASS).toString('base64') });
    res.status(401).json({ status: 'error' });
});

app.get('/api/admin/config', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    res.json({ config: pteroConfig, stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings } });
});

app.post('/api/admin/settings', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== Buffer.from(ADMIN_PASS).toString('base64')) return res.status(401).send();
    try {
        const { stats_buyers, stats_earnings, ...config } = req.body;
        pteroConfig = { ...pteroConfig, ...config, customerCounter: parseInt(stats_buyers) + 1, totalEarnings: parseInt(stats_earnings) };
        await saveAllData();
        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/api/check-services', async (req, res) => {
    const results = { ptero: 'offline', do: 'offline', linode: 'offline' };
    
    // Check Ptero
    try {
        if (pteroConfig.url && pteroConfig.key) {
            const r = await axios.get(`${pteroConfig.url}/api/application/nodes`, { headers: { 'Authorization': `Bearer ${pteroConfig.key}` }, timeout: 3000 });
            if (r.status === 200) results.ptero = 'online';
        }
    } catch (e) {}

    // Check Digital Ocean
    try {
        if (pteroConfig.do_token) {
            const r = await axios.get('https://api.digitalocean.com/v2/account', { headers: { 'Authorization': `Bearer ${pteroConfig.do_token}` }, timeout: 3000 });
            if (r.status === 200) results.do = 'online';
        }
    } catch (e) {}

    // Check Linode
    try {
        if (pteroConfig.linode_token) {
            const r = await axios.get('https://api.linode.com/v4/profile', { headers: { 'Authorization': `Bearer ${pteroConfig.linode_token}` }, timeout: 3000 });
            if (r.status === 200) results.linode = 'online';
        }
    } catch (e) {}

    res.json({ 
        status: results.ptero, // Main status
        services: results,
        stats: { totalBuyers: pteroConfig.customerCounter - 1, totalEarnings: pteroConfig.totalEarnings }
    });
});

// Alias for old endpoint
app.get('/api/check-ptero', (req, res) => res.redirect('/api/check-services'));

app.post('/api/checkout', (req, res) => {
    const { nominal, email, whatsapp, package_name, nest_id, egg_id } = req.body;
    const orderId = 'FZH-' + Date.now();
    orderMemory.set(orderId, { amount: nominal, email, whatsapp, package: package_name, nest_id, egg_id, status: 'pending' });
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const returnUrl = `${protocol}://${host}/status.html?order_id=${orderId}`;
    res.json({ status: 'success', checkout_url: `https://app.pakasir.com/pay/${PAKASIR_SLUG}/${nominal}?order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}` });
});

app.get('/api/verify', async (req, res) => {
    const orderId = req.query.order_id;
    const orderData = orderMemory.get(orderId);
    if (!orderData) return res.json({ status: 'error' });
    if (orderData.status === 'completed') return res.json({ status: 'success', credentials: orderData.credentials });
    try {
        const checkUrl = `https://app.pakasir.com/api/transactiondetail?project=${PAKASIR_SLUG}&amount=${orderData.amount}&order_id=${orderId}&api_key=${PAKASIR_API_KEY}`;
        const response = await axios.get(checkUrl);
        if (response.data.transaction?.status === 'completed') {
            const credentials = await processServerDeployment(orderId, orderData);
            return res.json({ status: 'success', credentials });
        }
        res.json({ status: 'pending' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/api/webhook/pakasir', async (req, res) => {
    const { order_id, status } = req.body;
    const orderData = orderMemory.get(order_id);
    if (!orderData) return res.sendStatus(200);
    try {
        const checkUrl = `https://app.pakasir.com/api/transactiondetail?project=${PAKASIR_SLUG}&amount=${orderData.amount}&order_id=${order_id}&api_key=${PAKASIR_API_KEY}`;
        const verifyRes = await axios.get(checkUrl);
        if (verifyRes.data.transaction?.status === 'completed') await processServerDeployment(order_id, orderData);
    } catch (e) {}
    res.sendStatus(200);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/Dev.html', (req, res) => res.sendFile(path.join(__dirname, 'Dev.html')));
app.get('/order-panel.html', (req, res) => res.sendFile(path.join(__dirname, 'order-panel.html')));
app.get('/order-vps.html', (req, res) => res.sendFile(path.join(__dirname, 'order-vps.html')));
app.get('/status.html', (req, res) => res.sendFile(path.join(__dirname, 'status.html')));

if (process.env.NODE_ENV !== 'production') app.listen(3000, () => console.log(`🚀 Ready`));
module.exports = app;