export type ModuleId =
  | 'overview'
  | 'cps'
  | 'typing'
  | 'spelling'
  | 'reaction'
  | 'rhythm'
  | 'wave'
  | 'shuffle'
  | 'friends'
  | 'leaderboards'
  | 'settings';

export type RemixMode = 'normal' | 'nightcore' | 'lofi';

export type JudgmentType = 'perfect' | 'good' | 'ok' | 'miss';

export type WordDifficulty = 'easy' | 'medium' | 'hard' | 'extreme';

export type WaveDifficulty = 'easy' | 'medium' | 'hard';

export type ShuffleDifficulty = 'easy' | 'medium' | 'hard';

export type ThemeMode = 'light' | 'dark';

export type AccentStyle = 'cobalt' | 'emerald' | 'violet' | 'rose';

export type BackgroundPreset = 'grid' | 'blueprint' | 'horizon' | 'solid' | 'custom';

export interface UiPreferences {
  theme: ThemeMode;
  accent: AccentStyle;
  lowDetailMode: boolean;
  backgroundPreset: BackgroundPreset;
  customBgOpacity: number;
}

export interface CpsBestRecord {
  bestCps: number;
  durationSec: number;
  totalClicks: number;
  achievedAt: number;
}

export interface TypingBestRecord {
  bestWpm: number;
  accuracy: number;
  modeLabel: string;
  achievedAt: number;
}

export interface SingleWordBestRecord {
  difficulty: WordDifficulty;
  wordsCleared: number;
  bestWpm: number;
  accuracy: number;
  achievedAt: number;
}

export interface SpellingBestRecord {
  difficulty: WordDifficulty;
  bestWords: number;
  bestStreak: number;
  accuracy: number;
  achievedAt: number;
}

export interface ReactionBestRecord {
  bestAverageMs: number;
  bestSingleMs: number;
  rounds: number;
  achievedAt: number;
}

export interface RhythmBestRecord {
  trackId: string;
  trackTitle: string;
  remix: RemixMode;
  bestScore: number;
  bestAccuracy: number;
  maxCombo: number;
  grade: string;
  achievedAt: number;
}

export interface WaveBestRecord {
  difficulty: WaveDifficulty;
  bestDistance: number;
  bestTimeSec: number;
  obstaclesCleared: number;
  achievedAt: number;
}

export interface ShuffleBestRecord {
  difficulty: ShuffleDifficulty;
  cupsCount: number;
  bestStreak: number;
  totalCorrect: number;
  achievedAt: number;
}

export interface RhythmConfig {
  leftKey: string;
  rightKey: string;
  scrollSpeed: number;
  audioOffsetMs: number;
  hitSounds: boolean;
}

export interface CpsConfig {
  primaryKey: string | null;
  secondaryKey: string | null;
}

export interface RecentRunEntry {
  id: string;
  module: Exclude<ModuleId, 'overview' | 'leaderboards' | 'settings' | 'friends'>;
  headlineMetric: string;
  detailText: string;
  timestamp: number;
}

export interface BenchmarkStore {
  cpsBests: Record<number, CpsBestRecord>;
  typingBest: TypingBestRecord | null;
  singleWordBests: Partial<Record<WordDifficulty, SingleWordBestRecord>>;
  spellingBests: Partial<Record<WordDifficulty, SpellingBestRecord>>;
  reactionBest: ReactionBestRecord | null;
  rhythmBests: Record<string, RhythmBestRecord>;
  waveBests: Partial<Record<WaveDifficulty, WaveBestRecord>>;
  shuffleBests: Partial<Record<ShuffleDifficulty, ShuffleBestRecord>>;
  rhythmConfig: RhythmConfig;
  cpsConfig: CpsConfig;
  sfxEnabled: boolean;
  uiPrefs: UiPreferences;
  recentRuns: RecentRunEntry[];
}

export interface NoteEvent {
  id: number;
  timeSec: number;
  lane: 0 | 1;
  durationSec?: number;
}

export type SynthPresetId = 'solar-pulse' | 'clockwork-grid' | 'velvet-horizon';

export interface RhythmTrack {
  id: string;
  title: string;
  subtitle: string;
  sourceType: 'synth' | 'upload';
  baseBpm: number;
  durationSec: number;
  synthPresetId?: SynthPresetId;
  audioBuffer?: AudioBuffer;
  baseOnsetsSec?: number[];
}
