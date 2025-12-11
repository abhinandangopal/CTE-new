import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { DocumentSession } from './services/DocumentSession';
import Redis from 'ioredis';
import cors from 'cors';
import { Kafka } from 'kafkajs';
import bcrypt from 'bcryptjs';
import validate from 'deep-email-validator';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// 1. Load Environment Variables
const result = dotenv.config();
if (result.error) {
    console.error("❌ CRITICAL ERROR: Could not find .env file!");
} else {
    console.log("✅ .env file loaded successfully.");
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 🟢 CONFIG
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const KAFKA_BROKER = process.env.KAFKA_BROKER || '127.0.0.1:9093';

// 🔍 DEBUG: Check if credentials exist (Don't print the real password)
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;

console.log("---------------------------------------------------");
console.log("📧 EMAIL CONFIG CHECK:");
console.log(`   User: ${emailUser ? emailUser : "❌ MISSING"}`);
console.log(`   Pass: ${emailPass ? "****** (Loaded)" : "❌ MISSING"}`);
console.log("---------------------------------------------------");

// 🟢 EMAIL CONFIGURATION
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: emailUser,
        pass: emailPass
    }
});

// 🔍 DEBUG: Test connection immediately
transporter.verify(function (error, success) {
    if (error) {
        console.error("🔥 GMAIL CONNECTION FAILED:");
        console.error(error);
        console.log("👉 TIP: Did you use your Login Password? You MUST use an App Password.");
        console.log("👉 TIP: Check for spaces in your .env file.");
    } else {
        console.log("✅ Gmail is ready to send emails!");
    }
});

console.log(`🔌 Config: Redis at ${REDIS_URL}`);
const redis = new Redis(REDIS_URL); 

console.log(`🔌 Config: Kafka at ${KAFKA_BROKER}`);
const kafka = new Kafka({ clientId: 'collab-app', brokers: [KAFKA_BROKER] });
const producer = kafka.producer();

const sessions = new Map<string, DocumentSession>();

// --- HELPER FUNCTIONS ---
async function isOwner(docId: string, userId: string) {
    const owner = await redis.get(`doc_owner:${docId}`);
    return owner === userId;
}

// --- AUTH ENDPOINTS ---

// 1. SIGN UP (Smart Verification)
app.post('/api/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and Password required" });

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasUpperCase || !hasLowerCase || !hasSpecial) {
        return res.status(400).json({ error: "Password must contain Upper, Lower, and Special characters." });
    }

    const domain = email.split('@')[1];
    const strictProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];
    const useStrict = strictProviders.includes(domain);

    try {
        const val = await validate({ 
            email, 
            sender: 'test@example.com',
            validateRegex: true,
            validateMx: true,
            validateTypo: true,
            validateDisposable: true,
            validateSMTP: useStrict 
        }); 
        
        if (!val.valid) {
            const reason = val.reason;
            let errorMessage = "Invalid email address.";
            if (reason === 'typo') {
                const typoInfo = val.validators.typo as any;
                errorMessage = `Did you mean ${typoInfo?.source}?`;
            } else if (reason === 'mx') {
                errorMessage = "This email domain does not exist.";
            } else if (reason === 'disposable') {
                errorMessage = "Temporary emails are not allowed.";
            } else if (reason === 'smtp') {
                errorMessage = "This email address does not exist.";
            }
            return res.status(400).json({ error: errorMessage });
        }
    } catch (e) {
        console.warn("Email validation warning:", e);
    }

    const existingHash = await redis.get(`user:auth:${email}`);
    if (existingHash) return res.status(409).json({ error: "User already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    await redis.set(`user:auth:${email}`, hashedPassword);
    res.json({ success: true, userId: email });
});

// 2. LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

    const storedHash = await redis.get(`user:auth:${email}`);
    if (!storedHash) return res.status(401).json({ error: "User not found." });

    const match = await bcrypt.compare(password, storedHash);
    if (!match) return res.status(401).json({ error: "Incorrect password." });

    res.json({ success: true, userId: email });
});

// 3. FORGOT PASSWORD
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const exists = await redis.get(`user:auth:${email}`);
    if (!exists) return res.json({ success: true, message: "If account exists, email sent." });

    const token = uuidv4();
    const redisKey = `reset_token:${token}`;
    await redis.setex(redisKey, 900, email);

    const resetLink = `http://localhost:5173/?resetToken=${token}`;
    
    const mailOptions = {
        from: 'CollabApp Support <noreply@collabapp.com>',
        to: email,
        subject: 'Reset Your Password',
        text: `You requested a password reset.\n\nClick here to reset: ${resetLink}\n\nThis link expires in 15 minutes.`
    };

    try {
        console.log(`📨 Attempting to send email to ${email}...`);
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email successfully sent to ${email}`);
        res.json({ success: true, message: "Email sent!" });
    } catch (error) {
        console.error("❌ FAILED to send email:", error);
        res.status(500).json({ error: "Failed to send email. Check server logs." });
    }
});

// 4. RESET PASSWORD
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "Missing data" });

    const email = await redis.get(`reset_token:${token}`);
    if (!email) return res.status(400).json({ error: "Invalid or expired token." });

    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
    if (!hasUpperCase || !hasLowerCase || !hasSpecial) {
        return res.status(400).json({ error: "Weak password. Use Upper, Lower, and Special chars." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await redis.set(`user:auth:${email}`, hashedPassword);
    await redis.del(`reset_token:${token}`);

    res.json({ success: true, message: "Password updated successfully!" });
});

// --- DOCUMENT API (UNCHANGED) ---
app.get('/api/docs/:userId', async (req, res) => { const { userId } = req.params; const docs = await redis.smembers(`user_docs:${userId}`); res.json(docs); });
app.post('/api/docs', async (req, res) => { const { userId, docId } = req.body; await redis.sadd(`user_docs:${userId}`, docId); await redis.set(`doc_owner:${docId}`, userId); await redis.rpush(`doc_tabs:${docId}`, "Sheet 1"); await redis.hset(`doc_acl:${docId}`, userId, 'owner'); await redis.hset(`doc_settings:${docId}`, 'link_access', 'none'); res.json({ success: true }); });
app.get('/api/doc/:docId/users', async (req, res) => { const { docId } = req.params; const acl = await redis.hgetall(`doc_acl:${docId}`); const linkAccess = await redis.hget(`doc_settings:${docId}`, 'link_access') || 'none'; res.json({ acl, linkAccess }); });
app.post('/api/doc/:docId/user', async (req, res) => { const { docId, ownerId, email, role } = req.body; if (!await isOwner(docId, ownerId)) return res.status(403).json({ error: "Not owner" }); await redis.hset(`doc_acl:${docId}`, email, role); await redis.sadd(`user_docs:${email}`, docId); res.json({ success: true }); });
app.delete('/api/doc/:docId/user', async (req, res) => { const { docId, ownerId, email } = req.body; if (!await isOwner(docId, ownerId)) return res.status(403).json({ error: "Not owner" }); await redis.hdel(`doc_acl:${docId}`, email); res.json({ success: true }); });
app.post('/api/doc/:docId/link-settings', async (req, res) => { const { docId, ownerId, linkAccess } = req.body; if (!await isOwner(docId, ownerId)) return res.status(403).json({ error: "Not owner" }); await redis.hset(`doc_settings:${docId}`, 'link_access', linkAccess); res.json({ success: true }); });
app.get('/api/doc/:docId/tabs', async (req, res) => { const { docId } = req.params; const tabs = await redis.lrange(`doc_tabs:${docId}`, 0, -1); if (tabs.length === 0) { await redis.rpush(`doc_tabs:${docId}`, "Sheet 1"); return res.json(["Sheet 1"]); } res.json(tabs); });
app.post('/api/doc/:docId/tabs', async (req, res) => { const { docId, tabName } = req.body; await redis.rpush(`doc_tabs:${docId}`, tabName); res.json({ success: true }); });

(async () => {
    try {
        await producer.connect();
        console.log("✅ Kafka Connected!");
        
        wss.on('connection', async (ws, req) => {
            const urlParams = new URLSearchParams(req.url?.split('?')[1]);
            const docId = urlParams.get('docId');
            const tabId = urlParams.get('tabId');
            const userId = urlParams.get('userId');
            if (!docId || !userId || !tabId) { ws.close(); return; }
            
            const owner = await redis.get(`doc_owner:${docId}`);
            let role = await redis.hget(`doc_acl:${docId}`, userId);
            const linkSetting = await redis.hget(`doc_settings:${docId}`, 'link_access') || 'none';
            if (userId !== owner && !role) {
                if (linkSetting !== 'none') { role = linkSetting; } else { ws.send(JSON.stringify({ type: 'error', message: 'Access Denied.' })); ws.close(); return; }
            }
            const finalRole = (userId === owner) ? 'owner' : role;
            const sessionKey = `${docId}::${tabId}`;
            if (!sessions.has(sessionKey)) sessions.set(sessionKey, new DocumentSession(sessionKey, producer));
            const session = sessions.get(sessionKey)!;
            const connectionId = await session.addUser(ws, userId, finalRole || 'viewer');
            ws.on('message', (message) => { const data = JSON.parse(message.toString()); session.handleEdit(connectionId, data); });
            ws.on('close', () => { session.removeUser(connectionId); });
        });

        const PORT = 8081;
        server.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });
    } catch (e) { console.error("🔥 Server failed to start:", e); }
})();