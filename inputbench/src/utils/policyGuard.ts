export interface BanState {
  banned: boolean;
  reason: string;
  message: string;
  ipHash?: string;
  bannedAt?: string;
}

const LOCAL_BAN_KEY = 'ib_sec_state_v2';
const LEGACY_LOCAL_BAN_KEY = 'ib_sec_state_v1';
const STORE_SIG_KEY = 'ib_store_sig_v1';
const CLIENT_SALT = 'IB_ZERO_TRUST_9F4A_2026';

// Explicit / NSFW / offensive terms prohibited under InputBench Policy Agreements
const EXPLICIT_TERM_REGEX =
  /(^|[^a-z0-9])(porn|porno|pornography|nsfw|hentai|rule34|xxx|nude|nudity|naked|erotic|fetish|onlyfans|boobs|tits|pussy|dick|cock|penis|vagina|cumshot|blowjob|handjob|milf|slut|whore|bitch|fuck|fucking|shit|cunt|nigga|nigger|faggot|gore|snuff|decapitate|beheading|rape|incest|ecchi|yiff|lewd|explicit|uncensored)([^a-z0-9]|$)/i;

// PowerShell, shell, XSS, and prototype pollution exploit signatures
const EXPLOIT_PATTERNS: RegExp[] = [
  /\bpowershell(\.exe)?\b/i,
  /\bpwsh(\.exe)?\b/i,
  /\binvoke-webrequest\b/i,
  /\binvoke-expression\b/i,
  /\b(iwr|irm|iex)\s+(https?:|['"-]|\$)/i,
  /-encodedcommand\b/i,
  /new-object\s+net\.webclient/i,
  /\bstart-process\b/i,
  /\bcmd\.exe\b/i,
  /<script[\s>]/i,
  /javascript\s*:/i,
  /\bon(error|load|click|mouseover)\s*=/i,
  /__proto__/i,
  /constructor\s*\.\s*prototype/i,
  /document\.cookie/i,
  /localstorage\.setitem/i,
];

export function checkPolicyContent(input: string): {
  allowed: boolean;
  matchedTerm?: string;
} {
  const normalized = input.replace(/[_.\-]+/g, ' ').trim();
  if (!normalized) return { allowed: true };
  const match = EXPLICIT_TERM_REGEX.exec(normalized);
  if (match) {
    return { allowed: false, matchedTerm: match[2] };
  }
  return { allowed: true };
}

export function detectExploitPayload(input: string): string | null {
  if (!input || input.length < 4) return null;
  for (const pattern of EXPLOIT_PATTERNS) {
    if (pattern.test(input)) {
      return pattern.source;
    }
  }
  return null;
}

export function fnv1aHash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function signStorePayload(serializedJson: string): string {
  const sig = fnv1aHash(`${CLIENT_SALT}::${serializedJson}`);
  try {
    localStorage.setItem(STORE_SIG_KEY, sig);
  } catch {
    // Ignore quota failures
  }
  return sig;
}

export function verifyStoreIntegrity(serializedJson: string): boolean {
  try {
    const storedSig = localStorage.getItem(STORE_SIG_KEY);
    if (!storedSig) {
      // Sign legacy pre-existing stores cleanly on first boot
      signStorePayload(serializedJson);
      return true;
    }
    const expected = fnv1aHash(`${CLIENT_SALT}::${serializedJson}`);
    return storedSig === expected;
  } catch {
    return true;
  }
}

export function saveLocalBanRecord(state: BanState): void {
  if (!state.banned) return;
  try {
    const body = JSON.stringify({
      banned: true,
      reason: state.reason,
      message: state.message,
      ipHash: state.ipHash ?? '',
      bannedAt: state.bannedAt ?? new Date().toISOString(),
    });
    const sig = fnv1aHash(`${CLIENT_SALT}::BAN_V2::${body}`);
    localStorage.setItem(LOCAL_BAN_KEY, JSON.stringify({ body, sig }));
  } catch {
    // Ignore storage issues
  }
}

export function loadLocalBanRecord(): BanState | null {
  try {
    localStorage.removeItem(LEGACY_LOCAL_BAN_KEY);
    const raw = localStorage.getItem(LOCAL_BAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { body?: string; sig?: string };
    if (!parsed.body || !parsed.sig) {
      return {
        banned: true,
        reason: 'hacking/exploits',
        message: 'nice try',
        bannedAt: new Date().toISOString(),
      };
    }
    const expected = fnv1aHash(`${CLIENT_SALT}::BAN_V2::${parsed.body}`);
    if (parsed.sig !== expected) {
      return {
        banned: true,
        reason: 'hacking/exploits',
        message: 'nice try',
        bannedAt: new Date().toISOString(),
      };
    }
    const data = JSON.parse(parsed.body) as BanState;
    return data.banned ? data : null;
  } catch {
    return null;
  }
}

export function clearLocalBanRecord(): void {
  try {
    localStorage.removeItem(LOCAL_BAN_KEY);
    localStorage.removeItem(LEGACY_LOCAL_BAN_KEY);
  } catch {
    // Ignore storage issues
  }
}
