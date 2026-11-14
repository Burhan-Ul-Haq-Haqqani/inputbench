import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
const ttsCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 250;

interface ServerBanRecord {
  ipHash: string;
  reason: string;
  message: string;
  bannedAt: string;
}

const BAN_COOKIE_NAME = 'ib_sec_lock_v2';
const LEGACY_BAN_COOKIE = 'ib_sec_lock';
const BAN_SECRET =
  process.env.SECURITY_BAN_SECRET ||
  process.env.GEMINI_API_KEY ||
  'inputbench_zero_trust_shield_v1_secret';
const bannedIps = new Map<string, ServerBanRecord>();

function extractClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  if (forwarded && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function hashClientIp(ip: string): string {
  return crypto.createHmac('sha256', BAN_SECRET).update(ip).digest('hex');
}

function signBanToken(record: ServerBanRecord): string {
  const payload = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', BAN_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyBanToken(token: string | undefined): ServerBanRecord | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.', 2);
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', BAN_SECRET)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as ServerBanRecord;
    if (parsed && parsed.ipHash && parsed.reason && parsed.message) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function synthesizeSpellingWord(word: string, voiceName: string): Promise<string> {
  const cleanVoice = ALLOWED_VOICES.has(voiceName) ? voiceName : 'Kore';
  const cacheKey = `${cleanVoice}::${word.toLowerCase()}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Say ${word}.`,
            speechMetadata: {
              style: 'Clear, articulate spelling bee announcer speaking distinctly at a natural pace',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: cleanVoice },
        },
      },
    },
  });

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('EMPTY_TTS_AUDIO');
  }

  if (ttsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(cacheKey, base64Audio);
  return base64Audio;
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/security', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const ipHash = hashClientIp(extractClientIp(req));
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[LEGACY_BAN_COOKIE]) {
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      const clearLegacy = isHttps
        ? `${LEGACY_BAN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure`
        : `${LEGACY_BAN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
      res.setHeader('Set-Cookie', clearLegacy);
    }
    const cookieBan = verifyBanToken(cookies[BAN_COOKIE_NAME]);
    const memoryBan = bannedIps.get(ipHash) ?? null;
    const activeBan = memoryBan || cookieBan;
    if (activeBan && !memoryBan) {
      bannedIps.set(ipHash, activeBan);
    }
    res.json({
      ipHash,
      banned: Boolean(activeBan),
      reason: activeBan?.reason ?? null,
      message: activeBan?.message ?? null,
      bannedAt: activeBan?.bannedAt ?? null,
    });
  });

  app.post('/api/security', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const action = typeof req.body?.action === 'string' ? req.body.action : '';
    const ipHash = hashClientIp(extractClientIp(req));
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (action !== 'ban') {
      res.status(400).json({ error: 'Invalid security action' });
      return;
    }

    const rawReason =
      typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    const rawMessage =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 120) : '';

    const record: ServerBanRecord = bannedIps.get(ipHash) ?? {
      ipHash,
      reason: rawReason || 'hacking/exploits',
      message: rawMessage || 'nice try',
      bannedAt: new Date().toISOString(),
    };
    bannedIps.set(ipHash, record);

    const token = signBanToken(record);
    const cookieAttrs = isHttps
      ? `${BAN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=None; Secure`
      : `${BAN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
    res.setHeader('Set-Cookie', cookieAttrs);

    res.json({
      ipHash,
      banned: true,
      reason: record.reason,
      message: record.message,
      bannedAt: record.bannedAt,
    });
  });

  app.post('/api/spelling-tts', async (req, res) => {
    try {
      const rawWord = typeof req.body?.word === 'string' ? req.body.word.trim() : '';
      const voiceName =
        typeof req.body?.voiceName === 'string' ? req.body.voiceName.trim() : 'Kore';

      if (!rawWord || rawWord.length > 60 || !/^[a-zA-Z-]+$/.test(rawWord)) {
        res.status(400).json({ error: 'Invalid word parameter' });
        return;
      }

      const audioBase64 = await synthesizeSpellingWord(rawWord, voiceName);
      res.json({
        audioBase64,
        mimeType: 'audio/wav',
        provider: 'gemini',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TTS generation failed';
      const status = message === 'GEMINI_API_KEY_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({
        fallback: true,
        error: message,
      });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`InputBench server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
