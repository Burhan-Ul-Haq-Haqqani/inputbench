import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AgeTier,
  ChatMode,
  enforceAgeTierConstraints,
  ParentalControlConfig,
  SafetyReportCategory,
} from './chatGuard';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface FriendshipRecord {
  pairId: string;
  participants: [string, string];
  participantUsernames: Record<string, string>;
  requestedBy: string;
  status: FriendshipStatus;
  blockedBy?: string;
  lastMessageText?: string;
  lastMessageAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ChatMessageRecord {
  id: string;
  pairId: string;
  participants: [string, string];
  senderUid: string;
  senderUsername: string;
  kind: 'preset' | 'text';
  text: string;
  createdAtMs: number;
}

export function buildPairId(uidA: string, uidB: string): {
  pairId: string;
  participants: [string, string];
} {
  const sorted: [string, string] =
    uidA < uidB ? [uidA, uidB] : [uidB, uidA];
  return {
    pairId: `${sorted[0]}_${sorted[1]}`,
    participants: sorted,
  };
}

export function getFriendPeer(
  friendship: FriendshipRecord,
  myUid: string
): { uid: string; username: string } {
  const peerUid =
    friendship.participants[0] === myUid
      ? friendship.participants[1]
      : friendship.participants[0];
  return {
    uid: peerUid,
    username: friendship.participantUsernames[peerUid] || 'Player',
  };
}

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  return 0;
}

export function parseParentalControlsSnap(
  uid: string,
  data: Record<string, unknown>
): ParentalControlConfig {
  const ageTier = (
    data.ageTier === 'under13' ||
    data.ageTier === 'teen13_17' ||
    data.ageTier === 'adult18plus'
      ? data.ageTier
      : 'adult18plus'
  ) as AgeTier;

  const chatMode = (
    data.chatMode === 'off' ||
    data.chatMode === 'friends_safe_presets' ||
    data.chatMode === 'friends_filtered'
      ? data.chatMode
      : 'friends_filtered'
  ) as ChatMode;

  return enforceAgeTierConstraints({
    uid: String(data.uid ?? uid),
    ageTier,
    chatMode,
    allowFriendRequests: Boolean(data.allowFriendRequests ?? true),
    requireParentApproval: Boolean(data.requireParentApproval ?? false),
    blockPiiAndLinks: Boolean(data.blockPiiAndLinks ?? true),
    allowCustomMedia: Boolean(data.allowCustomMedia ?? true),
    parentPinEnabled: Boolean(data.parentPinEnabled ?? false),
    ...(typeof data.pinHash === 'string' && data.pinHash.length === 64
      ? { pinHash: data.pinHash }
      : {}),
    blockedAttemptsCount: Number(data.blockedAttemptsCount ?? 0),
    createdAtMs: toMillis(data.createdAt),
    updatedAtMs: toMillis(data.updatedAt),
  });
}

export function subscribeParentalControls(
  uid: string,
  onData: (config: ParentalControlConfig | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const ref = doc(db, 'parentalControls', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(parseParentalControlsSnap(uid, snap.data()));
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function saveParentalControls(
  config: ParentalControlConfig,
  existsAlready: boolean
): Promise<ParentalControlConfig> {
  const safe = enforceAgeTierConstraints(config);
  const path = `parentalControls/${safe.uid}`;
  const ref = doc(db, 'parentalControls', safe.uid);

  const payload: Record<string, unknown> = {
    uid: safe.uid,
    ageTier: safe.ageTier,
    chatMode: safe.chatMode,
    allowFriendRequests: safe.allowFriendRequests,
    requireParentApproval: safe.requireParentApproval,
    blockPiiAndLinks: safe.blockPiiAndLinks,
    allowCustomMedia: safe.allowCustomMedia,
    parentPinEnabled: safe.parentPinEnabled,
    blockedAttemptsCount: safe.blockedAttemptsCount,
    updatedAt: serverTimestamp(),
  };

  if (safe.parentPinEnabled && safe.pinHash) {
    payload.pinHash = safe.pinHash;
  } else {
    payload.pinHash = '';
  }

  try {
    if (!existsAlready) {
      await setDoc(ref, {
        ...payload,
        blockedAttemptsCount: 0,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, payload);
    }
    return safe;
  } catch (err) {
    handleFirestoreError(
      err,
      existsAlready ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function recordBlockedSafetyAttempt(uid: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'parentalControls', uid), {
      blockedAttemptsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit increment
  }
}

export async function lookupUsername(
  username: string
): Promise<{ uid: string; username: string } | null> {
  const clean = username.trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(clean)) return null;
  const lower = clean.toLowerCase();
  const path = `usernames/${lower}`;
  try {
    const snap = await getDoc(doc(db, 'usernames', lower));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: String(d.uid),
      username: String(d.username),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export function subscribeFriendships(
  myUid: string,
  onData: (rows: FriendshipRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const q = query(
    collection(db, 'friendships'),
    where('participants', 'array-contains', myUid),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: FriendshipRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const rawParticipants = Array.isArray(data.participants)
          ? [String(data.participants[0] ?? ''), String(data.participants[1] ?? '')]
          : ['', ''];
        const rawUsernames =
          data.participantUsernames && typeof data.participantUsernames === 'object'
            ? (data.participantUsernames as Record<string, unknown>)
            : {};
        const participantUsernames: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawUsernames)) {
          participantUsernames[k] = String(v ?? 'Player');
        }
        return {
          pairId: String(data.pairId ?? d.id),
          participants: [rawParticipants[0], rawParticipants[1]],
          participantUsernames,
          requestedBy: String(data.requestedBy ?? ''),
          status: (data.status ?? 'pending') as FriendshipStatus,
          blockedBy: data.blockedBy ? String(data.blockedBy) : undefined,
          lastMessageText: data.lastMessageText
            ? String(data.lastMessageText)
            : undefined,
          lastMessageAtMs: toMillis(data.lastMessageAt),
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      list.sort(
        (a, b) =>
          (b.lastMessageAtMs || b.updatedAtMs) -
          (a.lastMessageAtMs || a.updatedAtMs)
      );
      onData(list);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function sendFriendRequest(params: {
  myUid: string;
  myUsername: string;
  targetUsername: string;
}): Promise<{ ok: boolean; message: string; pairId?: string }> {
  const { myUid, myUsername, targetUsername } = params;
  const cleanTarget = targetUsername.trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(cleanTarget)) {
    return {
      ok: false,
      message: 'Enter a valid username (3–20 letters, numbers, _ or -).',
    };
  }

  const target = await lookupUsername(cleanTarget);
  if (!target) {
    return {
      ok: false,
      message: `No InputBench player found with username "${cleanTarget}".`,
    };
  }

  if (target.uid === myUid) {
    return { ok: false, message: 'You cannot add yourself as a friend.' };
  }

  const { pairId, participants } = buildPairId(myUid, target.uid);
  const ref = doc(db, 'friendships', pairId);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData.status === 'accepted') {
        return { ok: false, message: `You are already friends with ${target.username}.` };
      }
      if (existingData.status === 'pending') {
        return {
          ok: false,
          message:
            existingData.requestedBy === myUid
              ? `Friend request already sent to ${target.username}.`
              : `${target.username} already sent you a friend request — check Pending Requests!`,
        };
      }
      if (existingData.status === 'blocked') {
        return {
          ok: false,
          message: 'Cannot send a friend request because one account has blocked the other.',
        };
      }
    }
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code !== 'not-found' && code !== 'permission-denied') {
      throw err;
    }
  }

  try {
    await setDoc(ref, {
      pairId,
      participants,
      participantUsernames: {
        [myUid]: myUsername,
        [target.uid]: target.username,
      },
      requestedBy: myUid,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      ok: true,
      pairId,
      message: `Friend request sent to ${target.username}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('permission') || msg.includes('insufficient')) {
      return {
        ok: false,
        message:
          'Friend request blocked by Parental Controls (one of the accounts has friend requests disabled).',
      };
    }
    return { ok: false, message: 'Unable to send friend request right now.' };
  }
}

export async function acceptFriendRequest(pairId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const path = `friendships/${pairId}`;
  try {
    await updateDoc(doc(db, 'friendships', pairId), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('permission') || msg.includes('insufficient')) {
      return {
        ok: false,
        error:
          'Cannot accept request: Parental Controls forbid friend connections on one of the accounts.',
      };
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeOrCancelFriendship(pairId: string): Promise<void> {
  const path = `friendships/${pairId}`;
  try {
    await deleteDoc(doc(db, 'friendships', pairId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function blockFriendRelationship(
  pairId: string,
  myUid: string
): Promise<void> {
  const path = `friendships/${pairId}`;
  try {
    await updateDoc(doc(db, 'friendships', pairId), {
      status: 'blocked',
      blockedBy: myUid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeChatMessages(
  pairId: string,
  myUid: string,
  onData: (messages: ChatMessageRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const q = query(
    collection(db, 'friendships', pairId, 'messages'),
    where('participants', 'array-contains', myUid),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: ChatMessageRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const rawParticipants = Array.isArray(data.participants)
          ? [String(data.participants[0] ?? ''), String(data.participants[1] ?? '')]
          : ['', ''];
        return {
          id: String(data.id ?? d.id),
          pairId: String(data.pairId ?? pairId),
          participants: [rawParticipants[0], rawParticipants[1]],
          senderUid: String(data.senderUid ?? ''),
          senderUsername: String(data.senderUsername ?? 'Player'),
          kind: data.kind === 'preset' ? 'preset' : 'text',
          text: String(data.text ?? ''),
          createdAtMs: toMillis(data.createdAt),
        };
      });
      list.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onData(list);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function sendChatMessage(params: {
  pairId: string;
  participants: [string, string];
  senderUid: string;
  senderUsername: string;
  kind: 'preset' | 'text';
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { pairId, participants, senderUid, senderUsername, kind, text } = params;
  const cleanText = text.trim();
  const msgRef = doc(collection(db, 'friendships', pairId, 'messages'));
  const friendshipRef = doc(db, 'friendships', pairId);

  const batch = writeBatch(db);
  batch.set(msgRef, {
    id: msgRef.id,
    pairId,
    participants,
    senderUid,
    senderUsername,
    kind,
    text: cleanText,
    createdAt: serverTimestamp(),
  });
  batch.update(friendshipRef, {
    lastMessageText: cleanText.slice(0, 200),
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('permission') || msg.includes('insufficient')) {
      return {
        ok: false,
        error:
          'Message rejected by Parental Controls: your friend’s account is restricted to Safe Presets Only or Chat Off.',
      };
    }
    return { ok: false, error: 'Unable to send message right now.' };
  }
}

export async function submitSafetyReport(params: {
  reporterUid: string;
  reportedUid: string;
  pairId: string;
  category: SafetyReportCategory;
  details: string;
  messageExcerpt: string;
  alsoBlock: boolean;
}): Promise<void> {
  const reportRef = doc(collection(db, 'safetyReports'));
  const batch = writeBatch(db);
  batch.set(reportRef, {
    reportId: reportRef.id,
    reporterUid: params.reporterUid,
    reportedUid: params.reportedUid,
    pairId: params.pairId,
    category: params.category,
    details: params.details.trim().slice(0, 500) || 'Safety report submitted.',
    messageExcerpt: params.messageExcerpt.trim().slice(0, 300),
    createdAt: serverTimestamp(),
  });
  if (params.alsoBlock) {
    batch.update(doc(db, 'friendships', params.pairId), {
      status: 'blocked',
      blockedBy: params.reporterUid,
      updatedAt: serverTimestamp(),
    });
  }
  const path = `safetyReports/${reportRef.id}`;
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
