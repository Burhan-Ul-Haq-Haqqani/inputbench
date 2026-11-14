import { checkPolicyContent, detectExploitPayload } from './policyGuard';

export type AgeTier = 'under13' | 'teen13_17' | 'adult18plus';
export type ChatMode = 'off' | 'friends_safe_presets' | 'friends_filtered';
export type SafetyReportCategory =
  | 'grooming_solicitation'
  | 'off_platform_luring'
  | 'explicit_content'
  | 'harassment'
  | 'cheating_exploit';

export interface ParentalControlConfig {
  uid: string;
  ageTier: AgeTier;
  chatMode: ChatMode;
  allowFriendRequests: boolean;
  requireParentApproval: boolean;
  blockPiiAndLinks: boolean;
  allowCustomMedia: boolean;
  parentPinEnabled: boolean;
  pinHash?: string;
  blockedAttemptsCount: number;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export const PARENT_PIN_REGEX = /^[0-9]{4,8}$/;

// Must match isSafePresetMessage() in firestore.rules character-for-character.
export const SAFE_CHAT_PRESETS = [
  'Hey! Want to play InputBench?',
  'Good game!',
  'Nice score!',
  'Want to try Click Speed?',
  'Want to race in Typing?',
  "Let's play Reaction Time!",
  "Let's try Heartbeat Wave!",
  'Want to play Ball Shuffle?',
  "Let's try AI Spelling!",
  'That was so close!',
  'New personal best!',
  'One more round?',
  'On my way!',
  'Hold on, one sec!',
  'Awesome timing!',
  'Gotta go, catch you later!',
  'Thanks for the match!',
  'Haha, nice try!',
] as const;

export type SafeChatPreset = (typeof SAFE_CHAT_PRESETS)[number];

export function isSafePresetText(text: string): text is SafeChatPreset {
  return (SAFE_CHAT_PRESETS as readonly string[]).includes(text);
}

export function getDefaultParentalControls(
  uid: string,
  ageTier: AgeTier,
  pinHash?: string
): ParentalControlConfig {
  const hasPin = Boolean(pinHash && /^[a-f0-9]{64}$/.test(pinHash));
  if (ageTier === 'under13') {
    return {
      uid,
      ageTier: 'under13',
      chatMode: 'friends_safe_presets',
      allowFriendRequests: false,
      requireParentApproval: true,
      blockPiiAndLinks: true,
      allowCustomMedia: false,
      parentPinEnabled: hasPin,
      ...(hasPin ? { pinHash } : {}),
      blockedAttemptsCount: 0,
    };
  }
  if (ageTier === 'teen13_17') {
    return {
      uid,
      ageTier: 'teen13_17',
      chatMode: 'friends_filtered',
      allowFriendRequests: true,
      requireParentApproval: false,
      blockPiiAndLinks: true,
      allowCustomMedia: true,
      parentPinEnabled: hasPin,
      ...(hasPin ? { pinHash } : {}),
      blockedAttemptsCount: 0,
    };
  }
  return {
    uid,
    ageTier: 'adult18plus',
    chatMode: 'friends_filtered',
    allowFriendRequests: true,
    requireParentApproval: false,
    blockPiiAndLinks: true,
    allowCustomMedia: true,
    parentPinEnabled: hasPin,
    ...(hasPin ? { pinHash } : {}),
    blockedAttemptsCount: 0,
  };
}

export function enforceAgeTierConstraints(
  cfg: ParentalControlConfig
): ParentalControlConfig {
  const next = { ...cfg };
  if (next.ageTier === 'under13') {
    if (next.chatMode === 'friends_filtered') {
      next.chatMode = 'friends_safe_presets';
    }
    next.blockPiiAndLinks = true;
  } else if (next.ageTier === 'teen13_17') {
    next.blockPiiAndLinks = true;
  }
  if (!next.parentPinEnabled) {
    delete next.pinHash;
  }
  return next;
}

export async function hashParentPin(pin: string, uid: string): Promise<string> {
  const cleanPin = pin.trim();
  if (!PARENT_PIN_REGEX.test(cleanPin)) {
    throw new Error('Parent PIN must be 4 to 8 digits.');
  }
  const input = new TextEncoder().encode(`IB_PARENT_PIN_V1:${uid}:${cleanPin}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ChatSafetyCheckResult {
  allowed: boolean;
  severe: boolean;
  category?: SafetyReportCategory;
  reason?: string;
}

const SEVERE_GROOMING_PATTERNS: RegExp[] = [
  /\b(send|show|dm)\s+(me\s+)?(nudes?|naked|boobs?|tits?|dick|cock|pussy|underwear|panties|bra)\b/i,
  /\b(undress|take\s+off\s+your\s+clothes|strip\s+for\s+me)\b/i,
  /\b(sugar\s+daddy|sugar\s+mommy|grooming|pedo|pedophile|loli|shota)\b/i,
  /\b(don'?t|do\s+not)\s+tell\s+(your|ur)\s+(mom|dad|parents?|family)\b/i,
  /\b(keep\s+(this|it)\s+(a\s+)?secret|our\s+little\s+secret)\b/i,
];

const SOLICITATION_PATTERNS: RegExp[] = [
  /\b(how\s+old\s+(are\s+you|r\s+u|ru)|what'?s\s+(your|ur)\s+age|asl\??)\b/i,
  /\b(where\s+do\s+(you|u)\s+live|what\s+(city|town|state|country|school)\s+(do\s+you|are\s+you|r\s+u))\b/i,
  /\b(what'?s\s+(your|ur)\s+(real\s+name|address|zip\s*code|phone\s*number|number))\b/i,
  /\b(are\s+you\s+home\s+alone|parents?\s+(home|asleep|gone)|you\s+alone\s+right\s+now)\b/i,
  /\b(send|show)\s+(me\s+)?(a\s+)?(pic|photo|selfie|video|face\s*reveal)\b/i,
  /\b(turn\s+on\s+(your\s+)?(cam|camera|webcam)|facetime\s+me|video\s*call\s+me)\b/i,
  /\b(meet\s+up|meet\s+in\s+real\s+life|irl\s+meet|come\s+over\s+to\s+my)\b/i,
];

const OFF_PLATFORM_LURING_PATTERNS: RegExp[] = [
  /\b(discord|dsc\.gg|snapchat|snap\s+me|telegram|t\.me|whatsapp|wa\.me|instagram|insta|tiktok|kik|signal|skype)\b/i,
  /\b(add\s+me\s+on|dm\s+me\s+on|message\s+me\s+on|text\s+me\s+at|call\s+me\s+at)\b/i,
  /\b(sc|ig|dc|tg)\s*[:=]\s*[a-z0-9_.@-]{2,}/i,
];

const LINK_OR_DOMAIN_PATTERN =
  /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|gg|io|xyz|ly|me|tv|co|app|dev|ru|tk|info|biz)\b)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PHONE_PATTERN = /\b(?:\+?\d[\s().-]*){7,15}\b/;

function collapseObfuscation(raw: string): string {
  // Remove zero-width chars and collapse spaced-out single characters like "d i s c o r d"
  const noZeroWidth = raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
  const collapsedSpaces = noZeroWidth.replace(
    /(?<=\b[a-zA-Z0-9])\s+(?=[a-zA-Z0-9]\b)/g,
    ''
  );
  return collapsedSpaces.replace(/([a-zA-Z])[._*-]+([a-zA-Z])/g, '$1$2');
}

export function checkChatSafety(
  rawText: string,
  options: { blockPiiAndLinks: boolean }
): ChatSafetyCheckResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { allowed: false, severe: false, reason: 'Message cannot be empty.' };
  }
  if (trimmed.length > 300) {
    return {
      allowed: false,
      severe: false,
      reason: 'Message cannot exceed 300 characters.',
    };
  }

  if (detectExploitPayload(trimmed)) {
    return {
      allowed: false,
      severe: true,
      category: 'cheating_exploit',
      reason: 'Script injection or exploit payload detected.',
    };
  }

  const policy = checkPolicyContent(trimmed);
  if (!policy.allowed) {
    return {
      allowed: false,
      severe: true,
      category: 'explicit_content',
      reason: 'Explicit, NSFW, or abusive language is strictly prohibited.',
    };
  }

  const normalized = collapseObfuscation(trimmed);
  const candidates = [trimmed, normalized];

  for (const text of candidates) {
    if (SEVERE_GROOMING_PATTERNS.some((re) => re.test(text))) {
      return {
        allowed: false,
        severe: true,
        category: 'grooming_solicitation',
        reason:
          'Severe child-safety violation detected (predatory solicitation or secrecy request).',
      };
    }

    if (SOLICITATION_PATTERNS.some((re) => re.test(text))) {
      return {
        allowed: false,
        severe: false,
        category: 'grooming_solicitation',
        reason:
          'Blocked by Safety Shield: asking for age, location, school, photos, or offline meetups is not allowed.',
      };
    }
  }

  if (options.blockPiiAndLinks) {
    for (const text of candidates) {
      if (OFF_PLATFORM_LURING_PATTERNS.some((re) => re.test(text))) {
        return {
          allowed: false,
          severe: false,
          category: 'off_platform_luring',
          reason:
            'Blocked by Parental Controls: sharing Discord, Snapchat, Telegram, Instagram, or moving chats off-platform is not allowed.',
        };
      }
      if (LINK_OR_DOMAIN_PATTERN.test(text)) {
        return {
          allowed: false,
          severe: false,
          category: 'off_platform_luring',
          reason:
            'Blocked by Parental Controls: external links and website URLs are disabled in chat.',
        };
      }
      if (EMAIL_PATTERN.test(text)) {
        return {
          allowed: false,
          severe: false,
          category: 'grooming_solicitation',
          reason:
            'Blocked by Parental Controls: sharing email addresses is not allowed.',
        };
      }
      if (PHONE_PATTERN.test(text)) {
        return {
          allowed: false,
          severe: false,
          category: 'grooming_solicitation',
          reason:
            'Blocked by Parental Controls: sharing phone numbers is not allowed.',
        };
      }
    }
  }

  return { allowed: true, severe: false };
}
