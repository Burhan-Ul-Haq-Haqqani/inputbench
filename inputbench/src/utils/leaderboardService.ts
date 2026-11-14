import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  BOARD_META_MAP,
  BoardKey,
  collectAllLocalPayloads,
  LeaderboardSubmissionPayload,
} from '../data/leaderboards';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BenchmarkStore } from '../types/benchmark';

export interface GlobalLeaderboardRow {
  uid: string;
  displayName: string;
  boardKey: BoardKey;
  gameId: string;
  score: number;
  scoreLabel: string;
  detailText: string;
  updatedAtMs: number;
}

export interface SubmitScoreResult {
  status: 'created' | 'improved' | 'unchanged' | 'skipped';
  boardKey: BoardKey;
}

export function sanitizePlayerDisplayName(
  rawName: string | null | undefined,
  fallback = 'InputBench Player'
): string {
  const cleaned = (rawName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned.length >= 1 ? cleaned : fallback;
}

function clampText(text: string, maxLen: number): string {
  const cleaned = text.replace(/[\r\n\t]+/g, ' ').trim();
  return (cleaned || '—').slice(0, maxLen);
}

export function isBetterBoardScore(
  boardKey: BoardKey,
  candidate: number,
  existing: number
): boolean {
  const meta = BOARD_META_MAP[boardKey];
  if (meta?.sortDirection === 'asc') {
    return candidate < existing;
  }
  return candidate > existing;
}

export function subscribeBoardEntries(
  boardKey: BoardKey,
  maxRows: number,
  onEntries: (rows: GlobalLeaderboardRow[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const meta = BOARD_META_MAP[boardKey];
  const sortDir = meta?.sortDirection ?? 'desc';
  const path = `leaderboards/${boardKey}/entries`;

  const q = query(
    collection(db, 'leaderboards', boardKey, 'entries'),
    where('score', '>=', 0),
    orderBy('score', sortDir),
    limit(maxRows)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: GlobalLeaderboardRow[] = snapshot.docs.map((snap) => {
        const data = snap.data();
        const updatedTs = data.updatedAt as Timestamp | undefined;
        return {
          uid: String(data.uid ?? snap.id),
          displayName: String(data.displayName ?? 'Player'),
          boardKey: (data.boardKey as BoardKey) ?? boardKey,
          gameId: String(data.gameId ?? meta?.gameId ?? 'cps'),
          score: typeof data.score === 'number' ? data.score : 0,
          scoreLabel: String(data.scoreLabel ?? '0'),
          detailText: String(data.detailText ?? ''),
          updatedAtMs: updatedTs ? updatedTs.toMillis() : Date.now(),
        };
      });
      onEntries(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function submitLeaderboardScore(
  user: User,
  displayName: string,
  payload: LeaderboardSubmissionPayload,
  forceProfileSync = false
): Promise<SubmitScoreResult> {
  if (!user.uid) {
    return { status: 'skipped', boardKey: payload.boardKey };
  }

  const boundedScore = Math.max(0, Math.min(10000000, payload.score));
  if (!Number.isFinite(boundedScore) || boundedScore <= 0) {
    return { status: 'skipped', boardKey: payload.boardKey };
  }

  const safeName = sanitizePlayerDisplayName(displayName);
  const safeScoreLabel = clampText(payload.scoreLabel, 64);
  const safeDetailText = clampText(payload.detailText, 120);
  const docPath = `leaderboards/${payload.boardKey}/entries/${user.uid}`;
  const entryRef = doc(db, 'leaderboards', payload.boardKey, 'entries', user.uid);

  let existingData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(entryRef);
    if (snap.exists()) {
      existingData = snap.data() as Record<string, unknown>;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  if (!existingData) {
    try {
      await setDoc(entryRef, {
        uid: user.uid,
        displayName: safeName,
        boardKey: payload.boardKey,
        gameId: payload.gameId,
        score: boundedScore,
        scoreLabel: safeScoreLabel,
        detailText: safeDetailText,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { status: 'created', boardKey: payload.boardKey };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }
  }

  const existingScore =
    typeof existingData.score === 'number' ? existingData.score : 0;
  const improved = isBetterBoardScore(
    payload.boardKey,
    boundedScore,
    existingScore
  );
  const nameChanged =
    forceProfileSync && String(existingData.displayName ?? '') !== safeName;

  if (!improved && !nameChanged) {
    return { status: 'unchanged', boardKey: payload.boardKey };
  }

  try {
    await updateDoc(entryRef, {
      displayName: safeName,
      score: improved ? boundedScore : existingScore,
      scoreLabel: improved
        ? safeScoreLabel
        : clampText(String(existingData.scoreLabel ?? safeScoreLabel), 64),
      detailText: improved
        ? safeDetailText
        : clampText(String(existingData.detailText ?? safeDetailText), 120),
      updatedAt: serverTimestamp(),
    });
    return {
      status: improved ? 'improved' : 'unchanged',
      boardKey: payload.boardKey,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function syncAllLocalBestsToGlobal(
  user: User,
  displayName: string,
  store: BenchmarkStore,
  forceProfileSync = false
): Promise<{ uploaded: number }> {
  const payloads = collectAllLocalPayloads(store);
  if (payloads.length === 0) return { uploaded: 0 };

  const results = await Promise.allSettled(
    payloads.map((p) =>
      submitLeaderboardScore(user, displayName, p, forceProfileSync)
    )
  );

  let uploaded = 0;
  for (const res of results) {
    if (
      res.status === 'fulfilled' &&
      (res.value.status === 'created' || res.value.status === 'improved')
    ) {
      uploaded++;
    }
  }
  return { uploaded };
}

export async function deleteMyBoardEntry(
  user: User,
  boardKey: BoardKey
): Promise<void> {
  const docPath = `leaderboards/${boardKey}/entries/${user.uid}`;
  try {
    await deleteDoc(doc(db, 'leaderboards', boardKey, 'entries', user.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
