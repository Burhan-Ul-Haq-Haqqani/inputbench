import {
  BenchmarkStore,
  CpsBestRecord,
  CpsConfig,
  ReactionBestRecord,
  RecentRunEntry,
  RhythmBestRecord,
  RhythmConfig,
  ShuffleBestRecord,
  SingleWordBestRecord,
  SpellingBestRecord,
  TypingBestRecord,
  UiPreferences,
  WaveBestRecord,
} from '../types/benchmark';

import { signStorePayload, verifyStoreIntegrity } from './policyGuard';

export const BENCHMARK_STORAGE_KEY = 'inputbench_lab_store_v1';

export const DEFAULT_RHYTHM_CONFIG: RhythmConfig = {
  leftKey: 'KeyD',
  rightKey: 'KeyK',
  scrollSpeed: 1.5,
  audioOffsetMs: 0,
  hitSounds: true,
};

export const DEFAULT_CPS_CONFIG: CpsConfig = {
  primaryKey: 'Space',
  secondaryKey: null,
};

export const DEFAULT_UI_PREFS: UiPreferences = {
  theme: 'light',
  accent: 'cobalt',
  lowDetailMode: false,
  backgroundPreset: 'grid',
  customBgOpacity: 0.35,
};

export const INITIAL_STORE: BenchmarkStore = {
  cpsBests: {},
  typingBest: null,
  singleWordBests: {},
  spellingBests: {},
  reactionBest: null,
  rhythmBests: {},
  waveBests: {},
  shuffleBests: {},
  rhythmConfig: DEFAULT_RHYTHM_CONFIG,
  cpsConfig: DEFAULT_CPS_CONFIG,
  sfxEnabled: true,
  uiPrefs: DEFAULT_UI_PREFS,
  recentRuns: [],
};

export function isBenchmarkStoreTampered(): boolean {
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    if (!raw) return false;
    return !verifyStoreIntegrity(raw);
  } catch {
    return false;
  }
}

export function loadBenchmarkStore(): BenchmarkStore {
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    if (!raw) return INITIAL_STORE;
    // Sign on initial app boot so legacy/migrated stores never trigger tamper alerts
    signStorePayload(raw);
    const parsed = JSON.parse(raw) as Partial<BenchmarkStore>;
    const store: BenchmarkStore = {
      cpsBests: parsed.cpsBests ?? {},
      typingBest: parsed.typingBest ?? null,
      singleWordBests: parsed.singleWordBests ?? {},
      spellingBests: parsed.spellingBests ?? {},
      reactionBest: parsed.reactionBest ?? null,
      rhythmBests: parsed.rhythmBests ?? {},
      waveBests: parsed.waveBests ?? {},
      shuffleBests: parsed.shuffleBests ?? {},
      rhythmConfig: {
        ...DEFAULT_RHYTHM_CONFIG,
        ...(parsed.rhythmConfig ?? {}),
      },
      cpsConfig: {
        ...DEFAULT_CPS_CONFIG,
        ...(parsed.cpsConfig ?? {}),
      },
      sfxEnabled: typeof parsed.sfxEnabled === 'boolean' ? parsed.sfxEnabled : true,
      uiPrefs: {
        ...DEFAULT_UI_PREFS,
        ...(parsed.uiPrefs ?? {}),
      },
      recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns.slice(0, 12) : [],
    };
    return store;
  } catch {
    return INITIAL_STORE;
  }
}

export function saveBenchmarkStore(store: BenchmarkStore): void {
  try {
    const serialized = JSON.stringify(store);
    localStorage.setItem(BENCHMARK_STORAGE_KEY, serialized);
    signStorePayload(serialized);
  } catch {
    // Ignore storage quota issues silently
  }
}

export function clearBenchmarkRecords(
  currentRhythmConfig: RhythmConfig,
  currentCpsConfig: CpsConfig,
  sfxEnabled: boolean,
  uiPrefs: UiPreferences
): BenchmarkStore {
  const next: BenchmarkStore = {
    ...INITIAL_STORE,
    rhythmConfig: currentRhythmConfig,
    cpsConfig: currentCpsConfig,
    sfxEnabled,
    uiPrefs,
  };
  saveBenchmarkStore(next);
  return next;
}

export function appendRecentRun(
  store: BenchmarkStore,
  entry: Omit<RecentRunEntry, 'id' | 'timestamp'>
): BenchmarkStore {
  const newEntry: RecentRunEntry = {
    ...entry,
    id: `${entry.module}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };
  const next: BenchmarkStore = {
    ...store,
    recentRuns: [newEntry, ...store.recentRuns].slice(0, 10),
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateCpsBest(
  store: BenchmarkStore,
  record: CpsBestRecord
): BenchmarkStore {
  const existing = store.cpsBests[record.durationSec];
  const isBetter = !existing || record.bestCps > existing.bestCps;
  const next: BenchmarkStore = {
    ...store,
    cpsBests: isBetter
      ? { ...store.cpsBests, [record.durationSec]: record }
      : store.cpsBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateTypingBest(
  store: BenchmarkStore,
  record: TypingBestRecord
): BenchmarkStore {
  const existing = store.typingBest;
  const isBetter =
    !existing ||
    record.bestWpm > existing.bestWpm ||
    (record.bestWpm === existing.bestWpm && record.accuracy > existing.accuracy);
  const next: BenchmarkStore = {
    ...store,
    typingBest: isBetter ? record : existing,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateSingleWordBest(
  store: BenchmarkStore,
  record: SingleWordBestRecord
): BenchmarkStore {
  const existing = store.singleWordBests[record.difficulty];
  const isBetter =
    !existing ||
    record.wordsCleared > existing.wordsCleared ||
    (record.wordsCleared === existing.wordsCleared && record.bestWpm > existing.bestWpm);
  const next: BenchmarkStore = {
    ...store,
    singleWordBests: isBetter
      ? { ...store.singleWordBests, [record.difficulty]: record }
      : store.singleWordBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateSpellingBest(
  store: BenchmarkStore,
  record: SpellingBestRecord
): BenchmarkStore {
  const existing = store.spellingBests[record.difficulty];
  const isBetter =
    !existing ||
    record.bestWords > existing.bestWords ||
    (record.bestWords === existing.bestWords && record.accuracy > existing.accuracy);
  const next: BenchmarkStore = {
    ...store,
    spellingBests: isBetter
      ? { ...store.spellingBests, [record.difficulty]: record }
      : store.spellingBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateReactionBest(
  store: BenchmarkStore,
  record: ReactionBestRecord
): BenchmarkStore {
  const existing = store.reactionBest;
  const isBetter =
    !existing || record.bestAverageMs < existing.bestAverageMs;
  const next: BenchmarkStore = {
    ...store,
    reactionBest: {
      bestAverageMs: isBetter ? record.bestAverageMs : existing.bestAverageMs,
      bestSingleMs: existing
        ? Math.min(existing.bestSingleMs, record.bestSingleMs)
        : record.bestSingleMs,
      rounds: isBetter ? record.rounds : existing.rounds,
      achievedAt: isBetter ? record.achievedAt : existing.achievedAt,
    },
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateRhythmBest(
  store: BenchmarkStore,
  record: RhythmBestRecord
): BenchmarkStore {
  const key = `${record.trackId}__${record.remix}`;
  const existing = store.rhythmBests[key];
  const isBetter =
    !existing ||
    record.bestScore > existing.bestScore ||
    (record.bestScore === existing.bestScore &&
      record.bestAccuracy > existing.bestAccuracy);
  const next: BenchmarkStore = {
    ...store,
    rhythmBests: isBetter
      ? { ...store.rhythmBests, [key]: record }
      : store.rhythmBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateWaveBest(
  store: BenchmarkStore,
  record: WaveBestRecord
): BenchmarkStore {
  const existing = store.waveBests[record.difficulty];
  const isBetter =
    !existing ||
    record.bestDistance > existing.bestDistance ||
    (record.bestDistance === existing.bestDistance &&
      record.obstaclesCleared > existing.obstaclesCleared);
  const next: BenchmarkStore = {
    ...store,
    waveBests: isBetter
      ? { ...store.waveBests, [record.difficulty]: record }
      : store.waveBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function updateShuffleBest(
  store: BenchmarkStore,
  record: ShuffleBestRecord
): BenchmarkStore {
  const existing = store.shuffleBests[record.difficulty];
  const isBetter =
    !existing ||
    record.bestStreak > existing.bestStreak ||
    (record.bestStreak === existing.bestStreak &&
      record.totalCorrect > existing.totalCorrect);
  const next: BenchmarkStore = {
    ...store,
    shuffleBests: isBetter
      ? { ...store.shuffleBests, [record.difficulty]: record }
      : store.shuffleBests,
  };
  saveBenchmarkStore(next);
  return next;
}

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'SPACE';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ShiftLeft') return 'L-SHIFT';
  if (code === 'ShiftRight') return 'R-SHIFT';
  if (code === 'Semicolon') return ';';
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Slash') return '/';
  return code.toUpperCase();
}
