import {
  BenchmarkStore,
  CpsBestRecord,
  ModuleId,
  ReactionBestRecord,
  RhythmBestRecord,
  ShuffleBestRecord,
  SingleWordBestRecord,
  SpellingBestRecord,
  TypingBestRecord,
  WaveBestRecord,
} from '../types/benchmark';

export type GameModuleId = Exclude<
  ModuleId,
  'overview' | 'leaderboards' | 'settings' | 'friends'
>;

export type BoardKey =
  | 'cps_1s'
  | 'cps_5s'
  | 'cps_10s'
  | 'cps_30s'
  | 'typing_paragraph'
  | 'typing_survival_easy'
  | 'typing_survival_medium'
  | 'typing_survival_hard'
  | 'typing_survival_extreme'
  | 'spelling_easy'
  | 'spelling_medium'
  | 'spelling_hard'
  | 'spelling_extreme'
  | 'reaction_3'
  | 'reaction_5'
  | 'reaction_10'
  | 'rhythm_solar-pulse'
  | 'rhythm_clockwork-grid'
  | 'rhythm_velvet-horizon'
  | 'rhythm_custom'
  | 'wave_easy'
  | 'wave_medium'
  | 'wave_hard'
  | 'shuffle_easy'
  | 'shuffle_medium'
  | 'shuffle_hard';

export interface LeaderboardBoardMeta {
  boardKey: BoardKey;
  gameId: GameModuleId;
  gameLabel: string;
  boardLabel: string;
  sortDirection: 'desc' | 'asc';
  metricHint: string;
}

export interface LeaderboardSubmissionPayload {
  boardKey: BoardKey;
  gameId: GameModuleId;
  score: number;
  scoreLabel: string;
  detailText: string;
}

export const LEADERBOARD_GAMES: {
  id: GameModuleId;
  label: string;
}[] = [
  { id: 'cps', label: 'Click Speed' },
  { id: 'typing', label: 'Typing' },
  { id: 'spelling', label: 'AI Spelling' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'rhythm', label: '2-Key Rhythm' },
  { id: 'wave', label: 'Heartbeat Wave' },
  { id: 'shuffle', label: 'Ball Shuffle' },
];

export const LEADERBOARD_BOARDS: LeaderboardBoardMeta[] = [
  // CPS
  {
    boardKey: 'cps_1s',
    gameId: 'cps',
    gameLabel: 'Click Speed',
    boardLabel: '1s Burst',
    sortDirection: 'desc',
    metricHint: 'Highest CPS',
  },
  {
    boardKey: 'cps_5s',
    gameId: 'cps',
    gameLabel: 'Click Speed',
    boardLabel: '5s Standard',
    sortDirection: 'desc',
    metricHint: 'Highest CPS',
  },
  {
    boardKey: 'cps_10s',
    gameId: 'cps',
    gameLabel: 'Click Speed',
    boardLabel: '10s Endurance',
    sortDirection: 'desc',
    metricHint: 'Highest CPS',
  },
  {
    boardKey: 'cps_30s',
    gameId: 'cps',
    gameLabel: 'Click Speed',
    boardLabel: '30s Marathon',
    sortDirection: 'desc',
    metricHint: 'Highest CPS',
  },
  // Typing
  {
    boardKey: 'typing_paragraph',
    gameId: 'typing',
    gameLabel: 'Typing',
    boardLabel: 'Paragraph WPM',
    sortDirection: 'desc',
    metricHint: 'Highest Net WPM',
  },
  {
    boardKey: 'typing_survival_easy',
    gameId: 'typing',
    gameLabel: 'Typing',
    boardLabel: 'Survival · Easy',
    sortDirection: 'desc',
    metricHint: 'Most Words Cleared',
  },
  {
    boardKey: 'typing_survival_medium',
    gameId: 'typing',
    gameLabel: 'Typing',
    boardLabel: 'Survival · Medium',
    sortDirection: 'desc',
    metricHint: 'Most Words Cleared',
  },
  {
    boardKey: 'typing_survival_hard',
    gameId: 'typing',
    gameLabel: 'Typing',
    boardLabel: 'Survival · Hard',
    sortDirection: 'desc',
    metricHint: 'Most Words Cleared',
  },
  {
    boardKey: 'typing_survival_extreme',
    gameId: 'typing',
    gameLabel: 'Typing',
    boardLabel: 'Survival · Extreme',
    sortDirection: 'desc',
    metricHint: 'Most Words Cleared',
  },
  // AI Spelling
  {
    boardKey: 'spelling_easy',
    gameId: 'spelling',
    gameLabel: 'AI Spelling',
    boardLabel: 'Easy',
    sortDirection: 'desc',
    metricHint: 'Most Words Spelled',
  },
  {
    boardKey: 'spelling_medium',
    gameId: 'spelling',
    gameLabel: 'AI Spelling',
    boardLabel: 'Medium',
    sortDirection: 'desc',
    metricHint: 'Most Words Spelled',
  },
  {
    boardKey: 'spelling_hard',
    gameId: 'spelling',
    gameLabel: 'AI Spelling',
    boardLabel: 'Hard',
    sortDirection: 'desc',
    metricHint: 'Most Words Spelled',
  },
  {
    boardKey: 'spelling_extreme',
    gameId: 'spelling',
    gameLabel: 'AI Spelling',
    boardLabel: 'Extreme',
    sortDirection: 'desc',
    metricHint: 'Most Words Spelled',
  },
  // Reaction
  {
    boardKey: 'reaction_3',
    gameId: 'reaction',
    gameLabel: 'Reaction',
    boardLabel: '3 Trials Avg',
    sortDirection: 'asc',
    metricHint: 'Lowest Avg ms',
  },
  {
    boardKey: 'reaction_5',
    gameId: 'reaction',
    gameLabel: 'Reaction',
    boardLabel: '5 Trials Avg',
    sortDirection: 'asc',
    metricHint: 'Lowest Avg ms',
  },
  {
    boardKey: 'reaction_10',
    gameId: 'reaction',
    gameLabel: 'Reaction',
    boardLabel: '10 Trials Avg',
    sortDirection: 'asc',
    metricHint: 'Lowest Avg ms',
  },
  // 2-Key Rhythm
  {
    boardKey: 'rhythm_solar-pulse',
    gameId: 'rhythm',
    gameLabel: '2-Key Rhythm',
    boardLabel: 'Solar Pulse',
    sortDirection: 'desc',
    metricHint: 'Highest Score',
  },
  {
    boardKey: 'rhythm_clockwork-grid',
    gameId: 'rhythm',
    gameLabel: '2-Key Rhythm',
    boardLabel: 'Clockwork Grid',
    sortDirection: 'desc',
    metricHint: 'Highest Score',
  },
  {
    boardKey: 'rhythm_velvet-horizon',
    gameId: 'rhythm',
    gameLabel: '2-Key Rhythm',
    boardLabel: 'Velvet Horizon',
    sortDirection: 'desc',
    metricHint: 'Highest Score',
  },
  {
    boardKey: 'rhythm_custom',
    gameId: 'rhythm',
    gameLabel: '2-Key Rhythm',
    boardLabel: 'Custom Audio',
    sortDirection: 'desc',
    metricHint: 'Highest Score',
  },
  // Heartbeat Wave
  {
    boardKey: 'wave_easy',
    gameId: 'wave',
    gameLabel: 'Heartbeat Wave',
    boardLabel: 'Easy',
    sortDirection: 'desc',
    metricHint: 'Furthest Distance (m)',
  },
  {
    boardKey: 'wave_medium',
    gameId: 'wave',
    gameLabel: 'Heartbeat Wave',
    boardLabel: 'Medium',
    sortDirection: 'desc',
    metricHint: 'Furthest Distance (m)',
  },
  {
    boardKey: 'wave_hard',
    gameId: 'wave',
    gameLabel: 'Heartbeat Wave',
    boardLabel: 'Hard',
    sortDirection: 'desc',
    metricHint: 'Furthest Distance (m)',
  },
  // Ball Shuffle
  {
    boardKey: 'shuffle_easy',
    gameId: 'shuffle',
    gameLabel: 'Ball Shuffle',
    boardLabel: 'Easy (2 Cups)',
    sortDirection: 'desc',
    metricHint: 'Longest Streak',
  },
  {
    boardKey: 'shuffle_medium',
    gameId: 'shuffle',
    gameLabel: 'Ball Shuffle',
    boardLabel: 'Medium (5 Cups)',
    sortDirection: 'desc',
    metricHint: 'Longest Streak',
  },
  {
    boardKey: 'shuffle_hard',
    gameId: 'shuffle',
    gameLabel: 'Ball Shuffle',
    boardLabel: 'Hard (10 Cups)',
    sortDirection: 'desc',
    metricHint: 'Longest Streak',
  },
];

export const BOARD_META_MAP: Record<BoardKey, LeaderboardBoardMeta> =
  Object.fromEntries(
    LEADERBOARD_BOARDS.map((b) => [b.boardKey, b])
  ) as Record<BoardKey, LeaderboardBoardMeta>;

export function getBoardsForGame(gameId: GameModuleId): LeaderboardBoardMeta[] {
  return LEADERBOARD_BOARDS.filter((b) => b.gameId === gameId);
}

export function getCpsBoardKey(durationSec: number): BoardKey {
  if (durationSec === 1) return 'cps_1s';
  if (durationSec === 10) return 'cps_10s';
  if (durationSec === 30) return 'cps_30s';
  return 'cps_5s';
}

export function getReactionBoardKey(rounds: number): BoardKey {
  if (rounds === 3) return 'reaction_3';
  if (rounds === 10) return 'reaction_10';
  return 'reaction_5';
}

export function getRhythmBoardKey(trackId: string): BoardKey {
  if (trackId === 'solar-pulse') return 'rhythm_solar-pulse';
  if (trackId === 'clockwork-grid') return 'rhythm_clockwork-grid';
  if (trackId === 'velvet-horizon') return 'rhythm_velvet-horizon';
  return 'rhythm_custom';
}

export function cpsRecordToPayload(
  record: CpsBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: getCpsBoardKey(record.durationSec),
    gameId: 'cps',
    score: Math.round(record.bestCps * 100) / 100,
    scoreLabel: `${record.bestCps.toFixed(2)} CPS`,
    detailText: `${record.durationSec}s · ${record.totalClicks} clicks`,
  };
}

export function typingParagraphToPayload(
  record: TypingBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: 'typing_paragraph',
    gameId: 'typing',
    score: Math.max(0, Math.round(record.bestWpm)),
    scoreLabel: `${record.bestWpm} WPM`,
    detailText: `${record.accuracy.toFixed(1)}% acc · ${record.modeLabel}`,
  };
}

export function singleWordToPayload(
  record: SingleWordBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: `typing_survival_${record.difficulty}` as BoardKey,
    gameId: 'typing',
    score: Math.max(0, Math.round(record.wordsCleared)),
    scoreLabel: `${record.wordsCleared} words`,
    detailText: `${record.bestWpm} WPM · ${record.accuracy.toFixed(1)}% acc`,
  };
}

export function spellingRecordToPayload(
  record: SpellingBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: `spelling_${record.difficulty}` as BoardKey,
    gameId: 'spelling',
    score: Math.max(0, Math.round(record.bestWords)),
    scoreLabel: `${record.bestWords} words`,
    detailText: `${record.accuracy.toFixed(1)}% acc · ${record.bestStreak} streak`,
  };
}

export function reactionRecordToPayload(
  record: ReactionBestRecord
): LeaderboardSubmissionPayload {
  const avg = Math.max(1, Math.round(record.bestAverageMs));
  return {
    boardKey: getReactionBoardKey(record.rounds),
    gameId: 'reaction',
    score: avg,
    scoreLabel: `${avg} ms`,
    detailText: `${record.rounds} trials · fastest ${record.bestSingleMs} ms`,
  };
}

export function rhythmRecordToPayload(
  record: RhythmBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: getRhythmBoardKey(record.trackId),
    gameId: 'rhythm',
    score: Math.max(0, Math.round(record.bestScore)),
    scoreLabel: `${record.bestScore.toLocaleString()} pts`,
    detailText: `${record.bestAccuracy.toFixed(1)}% · Grade ${record.grade} · ${record.maxCombo}x`,
  };
}

export function waveRecordToPayload(
  record: WaveBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: `wave_${record.difficulty}` as BoardKey,
    gameId: 'wave',
    score: Math.max(0, Math.round(record.bestDistance)),
    scoreLabel: `${record.bestDistance} m`,
    detailText: `${record.obstaclesCleared} slopes · ${record.bestTimeSec.toFixed(1)}s`,
  };
}

export function shuffleRecordToPayload(
  record: ShuffleBestRecord
): LeaderboardSubmissionPayload {
  return {
    boardKey: `shuffle_${record.difficulty}` as BoardKey,
    gameId: 'shuffle',
    score: Math.max(0, Math.round(record.bestStreak)),
    scoreLabel: `${record.bestStreak} streak`,
    detailText: `${record.cupsCount} cups · ${record.totalCorrect} total correct`,
  };
}

export function collectAllLocalPayloads(
  store: BenchmarkStore
): LeaderboardSubmissionPayload[] {
  const list: LeaderboardSubmissionPayload[] = [];

  Object.values(store.cpsBests).forEach((rec) => {
    if (rec && rec.bestCps > 0) list.push(cpsRecordToPayload(rec));
  });

  if (store.typingBest && store.typingBest.bestWpm > 0) {
    list.push(typingParagraphToPayload(store.typingBest));
  }

  Object.values(store.singleWordBests).forEach((rec) => {
    if (rec && rec.wordsCleared > 0) list.push(singleWordToPayload(rec));
  });

  Object.values(store.spellingBests).forEach((rec) => {
    if (rec && rec.bestWords > 0) list.push(spellingRecordToPayload(rec));
  });

  if (store.reactionBest && store.reactionBest.bestAverageMs > 0) {
    list.push(reactionRecordToPayload(store.reactionBest));
  }

  const rhythmByBoard = new Map<BoardKey, RhythmBestRecord>();
  Object.values(store.rhythmBests).forEach((rec) => {
    if (!rec || rec.bestScore <= 0) return;
    const key = getRhythmBoardKey(rec.trackId);
    const prev = rhythmByBoard.get(key);
    if (!prev || rec.bestScore > prev.bestScore) {
      rhythmByBoard.set(key, rec);
    }
  });
  rhythmByBoard.forEach((rec) => list.push(rhythmRecordToPayload(rec)));

  Object.values(store.waveBests).forEach((rec) => {
    if (rec && rec.bestDistance > 0) list.push(waveRecordToPayload(rec));
  });

  Object.values(store.shuffleBests).forEach((rec) => {
    if (rec && rec.bestStreak > 0) list.push(shuffleRecordToPayload(rec));
  });

  return list;
}
