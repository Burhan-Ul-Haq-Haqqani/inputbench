import crypto from 'node:crypto';

interface BanRecord {
  ipHash: string;
  reason: string;
  message: string;
  bannedAt: string;
}

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  body?: { action?: unknown; reason?: unknown; message?: unknown };
}

interface VercelRes {
  status: (code: number) => VercelRes;
  setHeader: (name: string, value: string | string[]) => void;
  json: (payload: unknown) => void;
}

const BAN_COOKIE_NAME = 'ib_sec_lock_v2';
const LEGACY_BAN_COOKIE = 'ib_sec_lock';
const BAN_SECRET =
  process.env.SECURITY_BAN_SECRET ||
  process.env.GEMINI_API_KEY ||
  'inputbench_zero_trust_shield_v1_secret';

const bannedIps = new Map<string, BanRecord>();

function getClientIp(req: VercelReq): string {
  const xff = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  if (forwarded && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function hashIp(ip: string): string {
  return crypto.createHmac('sha256', BAN_SECRET).update(ip).digest('hex');
}

function signBanToken(record: BanRecord): string {
  const payload = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', BAN_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyBanToken(token: string | undefined): BanRecord | null {
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
    ) as BanRecord;
    if (parsed && parsed.ipHash && parsed.reason && parsed.message) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export default function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);
  const cookies = parseCookies(req.headers.cookie);
  const cookieBan = verifyBanToken(cookies[BAN_COOKIE_NAME]);
  const memoryBan = bannedIps.get(ipHash) ?? null;

  const proto = req.headers['x-forwarded-proto'];
  const isHttps = proto === 'https' || (Array.isArray(proto) && proto.includes('https'));

  if (req.method === 'GET') {
    if (cookies[LEGACY_BAN_COOKIE]) {
      const clearLegacy = isHttps
        ? `${LEGACY_BAN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure`
        : `${LEGACY_BAN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
      res.setHeader('Set-Cookie', clearLegacy);
    }
    const activeBan = memoryBan || cookieBan;
    if (activeBan && !memoryBan) {
      bannedIps.set(ipHash, activeBan);
    }
    res.status(200).json({
      ipHash,
      banned: Boolean(activeBan),
      reason: activeBan?.reason ?? null,
      message: activeBan?.message ?? null,
      bannedAt: activeBan?.bannedAt ?? null,
    });
    return;
  }

  if (req.method === 'POST') {
    const action = typeof req.body?.action === 'string' ? req.body.action : '';
    if (action !== 'ban') {
      res.status(400).json({ error: 'Invalid security action' });
      return;
    }

    const rawReason =
      typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    const rawMessage =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 120) : '';

    const record: BanRecord = memoryBan ?? {
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
    res.status(200).json({
      ipHash,
      banned: true,
      reason: record.reason,
      message: record.message,
      bannedAt: record.bannedAt,
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
