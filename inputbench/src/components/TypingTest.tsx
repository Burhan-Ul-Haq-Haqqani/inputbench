import { Heart, RotateCcw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import {
  BoardKey,
  singleWordToPayload,
  typingParagraphToPayload,
} from '../data/leaderboards';
import {
  ModuleId,
  SingleWordBestRecord,
  TypingBestRecord,
  WordDifficulty,
} from '../types/benchmark';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';

interface TypingTestProps {
  bestRecord: TypingBestRecord | null;
  singleWordBests: Partial<Record<WordDifficulty, SingleWordBestRecord>>;
  onCompleteParagraph: (
    record: TypingBestRecord,
    rawWpm: number,
    errors: number
  ) => void;
  onCompleteSingleWord: (record: SingleWordBestRecord) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type TypingSectionTab = 'paragraph' | 'single-word';
type ParagraphMode = '30s' | '60s' | 'full';
type ParagraphPhase = 'READY' | 'TYPING' | 'FINISHED';
type WordPhase = 'READY' | 'PLAYING' | 'GAME_OVER';

const PARAGRAPHS: string[] = [
  'precision in computer input comes from rhythmic consistency rather than frantic bursts keep your wrists neutral scan two words ahead of the active cursor and let accurate muscle memory build speed naturally over time',
  'modern web audio engines schedule oscillators filters and sampled buffers against a hardware locked clock even a ten millisecond drift between visual frames and sound cues becomes noticeable during fast two key rhythm passages',
  'high throughput typists rarely pause to stare at individual characters instead they recognize common prefixes suffixes and letter pairs as unified motor chords that flow smoothly across the home row',
  'every benchmark measurement tells only half the story without error rate context typing at ninety words per minute with frequent backspaces often trails a steady seventy five words per minute run with near perfect accuracy',
  'clean instrument design removes visual clutter so attention stays anchored on the primary task clear typography crisp contrast and immediate tactile feedback turn raw practice sessions into measurable skill gains',
  'when practicing difficult vocabulary slow down just enough to eliminate hesitation before unfamiliar letter combinations once the finger sequence stabilizes acceleration follows without sacrificing control',
];

const DIFFICULTY_META: Record<
  WordDifficulty,
  { label: string; sample: string; words: string[] }
> = {
  easy: {
    label: 'Easy',
    sample: 'yes',
    words: [
      'yes', 'no', 'go', 'up', 'run', 'key', 'tap', 'box', 'dot', 'mix',
      'day', 'sky', 'top', 'end', 'win', 'try', 'red', 'sun', 'air', 'bit',
      'map', 'set', 'hit', 'two', 'fast', 'play', 'beat', 'note', 'time', 'code',
    ],
  },
  medium: {
    label: 'Medium',
    sample: 'kinetic',
    words: [
      'balance', 'capture', 'kinetic', 'channel', 'latency', 'monitor',
      'trigger', 'pattern', 'velocity', 'rhythm', 'network', 'browser',
      'process', 'digital', 'surface', 'profile', 'display', 'current',
      'project', 'control', 'signal', 'buffer', 'vector', 'syntax',
    ],
  },
  hard: {
    label: 'Hard',
    sample: 'calibration',
    words: [
      'calibration', 'consistency', 'methodology', 'performance',
      'benchmarking', 'acceleration', 'coordination', 'oscillation',
      'architecture', 'differential', 'configuration', 'implementation',
      'synchronization', 'troubleshooting', 'responsiveness', 'authentication',
      'visualization', 'infrastructure',
    ],
  },
  extreme: {
    label: 'Extreme',
    sample: 'Conceptualization',
    words: [
      'Conceptualization',
      'Microarchitecture',
      'Telecommunications',
      'Counterproductive',
      'Multidimensional',
      'Uncharacteristically',
      'Interdisciplinary',
      'Incomprehensible',
      'Hypersensitivity',
      'Instrumentation',
      'Deconstructionist',
      'Thermodynamics',
      'Compartmentalization',
      'Electroencephalography',
      'Disproportionately',
      'Overcompensation',
    ],
  },
};

function pickRandomParagraph(exclude?: string): string {
  const pool = PARAGRAPHS.filter((p) => p !== exclude);
  return pool[Math.floor(Math.random() * pool.length)] ?? PARAGRAPHS[0];
}

function pickWordForDifficulty(
  difficulty: WordDifficulty,
  exclude?: string,
  preferAnchor = false
): string {
  const list = DIFFICULTY_META[difficulty].words;
  if (preferAnchor) {
    if (difficulty === 'easy') return 'yes';
    if (difficulty === 'extreme') return 'Conceptualization';
  }
  const pool = list.filter((w) => w !== exclude);
  return pool[Math.floor(Math.random() * pool.length)] ?? list[0];
}

export function TypingTest({
  bestRecord,
  singleWordBests,
  onCompleteParagraph,
  onCompleteSingleWord,
  onOpenLeaderboards,
}: TypingTestProps) {
  const [sectionTab, setSectionTab] = useState<TypingSectionTab>('paragraph');

  // --- Paragraph Typing State ---
  const [paraMode, setParaMode] = useState<ParagraphMode>('full');
  const [paraPhase, setParaPhase] = useState<ParagraphPhase>('READY');
  const [paragraphText, setParagraphText] = useState<string>(() => pickRandomParagraph());
  const [typedText, setTypedText] = useState<string>('');
  const [paraElapsedSec, setParaElapsedSec] = useState<number>(0);
  const [paraTotalKeys, setParaTotalKeys] = useState<number>(0);
  const [paraCorrectKeys, setParaCorrectKeys] = useState<number>(0);
  const [paraErrorKeys, setParaErrorKeys] = useState<number>(0);
  const [paraWpmHistory, setParaWpmHistory] = useState<number[]>([]);
  const [paraFocused, setParaFocused] = useState<boolean>(true);

  const paraStageRef = useRef<HTMLDivElement | null>(null);
  const paraStartRef = useRef<number>(0);
  const paraIntervalRef = useRef<number | null>(null);
  const paraPhaseRef = useRef<ParagraphPhase>('READY');
  const paraSampleSecRef = useRef<number>(0);
  const typedTextRef = useRef<string>('');
  const paraStatsRef = useRef({ correct: 0, total: 0, errors: 0 });

  useEffect(() => {
    typedTextRef.current = typedText;
  }, [typedText]);

  // --- Single-Word Survival State ---
  const [difficulty, setDifficulty] = useState<WordDifficulty>('easy');
  const [wordPhase, setWordPhase] = useState<WordPhase>('READY');
  const [currentWord, setCurrentWord] = useState<string>(() =>
    pickWordForDifficulty('easy', undefined, true)
  );
  const [wordInput, setWordInput] = useState<string>('');
  const [lives, setLives] = useState<number>(3);
  const [wordsCleared, setWordsCleared] = useState<number>(0);
  const [wordElapsedSec, setWordElapsedSec] = useState<number>(0);
  const [wordCorrectChars, setWordCorrectChars] = useState<number>(0);
  const [wordTotalChars, setWordTotalChars] = useState<number>(0);
  const [strikeBanner, setStrikeBanner] = useState<string | null>(null);
  const [wordFocused, setWordFocused] = useState<boolean>(true);

  const wordStageRef = useRef<HTMLDivElement | null>(null);
  const wordStartRef = useRef<number>(0);
  const wordIntervalRef = useRef<number | null>(null);
  const wordPhaseRef = useRef<WordPhase>('READY');
  const lastStrikeAtRef = useRef<number>(0);
  const wordStatsRef = useRef({
    lives: 3,
    cleared: 0,
    correctChars: 0,
    totalChars: 0,
  });

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (paraIntervalRef.current !== null) window.clearInterval(paraIntervalRef.current);
      if (wordIntervalRef.current !== null) window.clearInterval(wordIntervalRef.current);
    };
  }, []);

  const targetTimeSec = paraMode === '30s' ? 30 : paraMode === '60s' ? 60 : null;

  const finishParagraph = useCallback(
    (finalElapsedSec: number, expected: string, typed: string) => {
      if (paraIntervalRef.current !== null) {
        window.clearInterval(paraIntervalRef.current);
        paraIntervalRef.current = null;
      }
      paraPhaseRef.current = 'FINISHED';
      setParaPhase('FINISHED');
      sfx.playLevelComplete();

      const safeSec = Math.max(finalElapsedSec, 0.5);
      const mins = safeSec / 60;
      let matchingChars = 0;
      for (let i = 0; i < typed.length; i++) {
        if (typed[i] === expected[i]) matchingChars++;
      }

      const netWpm = Math.max(0, Math.round(matchingChars / 5 / mins));
      const rawWpm = Math.max(0, Math.round(paraStatsRef.current.total / 5 / mins));
      const totalPressed = Math.max(
        1,
        paraStatsRef.current.correct + paraStatsRef.current.errors
      );
      const accuracy =
        Math.round((paraStatsRef.current.correct / totalPressed) * 1000) / 10;

      const modeLabel = paraMode === 'full' ? 'Full Paragraph' : paraMode;
      onCompleteParagraph(
        {
          bestWpm: netWpm,
          accuracy,
          modeLabel,
          achievedAt: Date.now(),
        },
        rawWpm,
        paraStatsRef.current.errors
      );
    },
    [onCompleteParagraph, paraMode]
  );

  const resetParagraph = useCallback(
    (nextMode?: ParagraphMode) => {
      if (paraIntervalRef.current !== null) {
        window.clearInterval(paraIntervalRef.current);
        paraIntervalRef.current = null;
      }
      if (nextMode) setParaMode(nextMode);
      paraPhaseRef.current = 'READY';
      paraStatsRef.current = { correct: 0, total: 0, errors: 0 };
      paraSampleSecRef.current = 0;
      typedTextRef.current = '';

      setParaPhase('READY');
      setParagraphText((prev) => pickRandomParagraph(prev));
      setTypedText('');
      setParaElapsedSec(0);
      setParaTotalKeys(0);
      setParaCorrectKeys(0);
      setParaErrorKeys(0);
      setParaWpmHistory([]);
      setParaFocused(true);
      paraStageRef.current?.focus();
    },
    []
  );

  const startParagraphTimer = useCallback(
    (expectedSnapshot: string) => {
      paraStartRef.current = performance.now();
      paraPhaseRef.current = 'TYPING';
      setParaPhase('TYPING');
      paraSampleSecRef.current = 0;
      sfx.playLevelStart();

      paraIntervalRef.current = window.setInterval(() => {
        if (paraPhaseRef.current !== 'TYPING') return;
        const nowSec = (performance.now() - paraStartRef.current) / 1000;
        setParaElapsedSec(nowSec);

        const wholeSec = Math.floor(nowSec);
        if (wholeSec > paraSampleSecRef.current && wholeSec >= 1) {
          paraSampleSecRef.current = wholeSec;
          const mins = nowSec / 60;
          const liveWpm = Math.max(
            0,
            Math.round(paraStatsRef.current.correct / 5 / mins)
          );
          setParaWpmHistory((prev) => [...prev, liveWpm]);
        }

        if (targetTimeSec !== null && nowSec >= targetTimeSec) {
          finishParagraph(targetTimeSec, expectedSnapshot, typedTextRef.current);
        }
      }, 60);
    },
    [finishParagraph, targetTimeSec]
  );

  const handleParagraphKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      resetParagraph();
      return;
    }

    if (paraPhaseRef.current === 'FINISHED') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (paraPhaseRef.current !== 'TYPING') return;
      if (typedText.length > 0) {
        setTypedText((prev) => prev.slice(0, -1));
      }
      return;
    }

    if (typeof e.key === 'string' && e.key.length === 1) {
      e.preventDefault();
      if (paraPhaseRef.current === 'READY') {
        startParagraphTimer(paragraphText);
      }

      const pos = typedText.length;
      if (pos >= paragraphText.length) return;

      const typedLower = e.key.toLowerCase();
      const expectedLower = paragraphText[pos].toLowerCase();
      const isCorrect = typedLower === expectedLower;
      paraStatsRef.current.total++;
      if (isCorrect) {
        paraStatsRef.current.correct++;
        sfx.playKeyTap();
      } else {
        paraStatsRef.current.errors++;
        sfx.playKeyError();
      }

      setParaTotalKeys(paraStatsRef.current.total);
      setParaCorrectKeys(paraStatsRef.current.correct);
      setParaErrorKeys(paraStatsRef.current.errors);

      const nextTyped = typedText + typedLower;
      setTypedText(nextTyped);

      if (nextTyped.length >= paragraphText.length) {
        const finalSec = (performance.now() - paraStartRef.current) / 1000;
        setParaElapsedSec(finalSec);
        finishParagraph(finalSec, paragraphText, nextTyped);
      }
    }
  };

  // --- Single-Word Survival Handlers ---
  const resetSingleWord = useCallback(
    (nextDifficulty?: WordDifficulty) => {
      if (wordIntervalRef.current !== null) {
        window.clearInterval(wordIntervalRef.current);
        wordIntervalRef.current = null;
      }
      const activeDiff = nextDifficulty ?? difficulty;
      if (nextDifficulty) setDifficulty(nextDifficulty);

      wordPhaseRef.current = 'READY';
      wordStatsRef.current = {
        lives: 3,
        cleared: 0,
        correctChars: 0,
        totalChars: 0,
      };
      lastStrikeAtRef.current = 0;

      setWordPhase('READY');
      setCurrentWord(pickWordForDifficulty(activeDiff, undefined, true));
      setWordInput('');
      setLives(3);
      setWordsCleared(0);
      setWordElapsedSec(0);
      setWordCorrectChars(0);
      setWordTotalChars(0);
      setStrikeBanner(null);
      setWordFocused(true);
      wordStageRef.current?.focus();
    },
    [difficulty]
  );

  const startSingleWordTimer = useCallback(() => {
    wordStartRef.current = performance.now();
    wordPhaseRef.current = 'PLAYING';
    setWordPhase('PLAYING');
    sfx.playLevelStart();

    wordIntervalRef.current = window.setInterval(() => {
      if (wordPhaseRef.current !== 'PLAYING') return;
      setWordElapsedSec((performance.now() - wordStartRef.current) / 1000);
    }, 80);
  }, []);

  const endSingleWordGame = useCallback(
    (finalElapsedSec: number) => {
      if (wordIntervalRef.current !== null) {
        window.clearInterval(wordIntervalRef.current);
        wordIntervalRef.current = null;
      }
      wordPhaseRef.current = 'GAME_OVER';
      setWordPhase('GAME_OVER');
      sfx.playDeath();

      const safeSec = Math.max(finalElapsedSec, 0.5);
      const mins = safeSec / 60;
      const bestWpm = Math.max(
        0,
        Math.round(wordStatsRef.current.correctChars / 5 / mins)
      );
      const total = Math.max(1, wordStatsRef.current.totalChars);
      const acc =
        Math.round((wordStatsRef.current.correctChars / total) * 1000) / 10;

      onCompleteSingleWord({
        difficulty,
        wordsCleared: wordStatsRef.current.cleared,
        bestWpm,
        accuracy: acc,
        achievedAt: Date.now(),
      });
    },
    [difficulty, onCompleteSingleWord]
  );

  const handleSingleWordKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      resetSingleWord();
      return;
    }

    if (wordPhaseRef.current === 'GAME_OVER') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (wordInput.length > 0) {
        setWordInput((prev) => prev.slice(0, -1));
      }
      return;
    }

    if (typeof e.key === 'string' && e.key.length === 1) {
      e.preventDefault();
      if (e.key === ' ') return;

      const now = performance.now();
      if (now - lastStrikeAtRef.current < 220) return;

      if (wordPhaseRef.current === 'READY') {
        startSingleWordTimer();
      }

      const pos = wordInput.length;
      const expectedChar = currentWord[pos];
      if (!expectedChar) return;
      wordStatsRef.current.totalChars++;
      setWordTotalChars(wordStatsRef.current.totalChars);

      if (e.key.toLowerCase() === expectedChar.toLowerCase()) {
        wordStatsRef.current.correctChars++;
        setWordCorrectChars(wordStatsRef.current.correctChars);
        const nextInput = wordInput + expectedChar;
        setWordInput(nextInput);
        setStrikeBanner(null);

        if (nextInput === currentWord) {
          wordStatsRef.current.cleared++;
          setWordsCleared(wordStatsRef.current.cleared);
          sfx.playWordClear();
          setWordInput('');
          setCurrentWord((prev) => pickWordForDifficulty(difficulty, prev));
        } else {
          sfx.playKeyTap();
        }
      } else {
        // Typo = 1 fail (1 life lost)
        lastStrikeAtRef.current = now;
        const remaining = wordStatsRef.current.lives - 1;
        wordStatsRef.current.lives = remaining;
        setLives(remaining);

        if (remaining <= 0) {
          const finalSec = (now - wordStartRef.current) / 1000;
          setWordElapsedSec(finalSec);
          endSingleWordGame(finalSec);
        } else {
          sfx.playStrike();
          setStrikeBanner(
            `Mistyped "${e.key}" instead of "${expectedChar}" · ${remaining} ${
              remaining === 1 ? 'life' : 'lives'
            } left`
          );
          setWordInput('');
          setCurrentWord((prev) => pickWordForDifficulty(difficulty, prev));
        }
      }
    }
  };

  useEffect(() => {
    if (sectionTab === 'paragraph') {
      paraStageRef.current?.focus();
    } else {
      wordStageRef.current?.focus();
    }
  }, [sectionTab]);

  // Derived Paragraph metrics
  const paraActiveSec =
    targetTimeSec !== null ? Math.min(paraElapsedSec, targetTimeSec) : paraElapsedSec;
  const paraLiveWpm =
    paraActiveSec > 0.35
      ? Math.max(0, Math.round(paraCorrectKeys / 5 / (paraActiveSec / 60)))
      : 0;
  const paraRawWpm =
    paraActiveSec > 0.35
      ? Math.max(0, Math.round(paraTotalKeys / 5 / (paraActiveSec / 60)))
      : 0;
  const paraTotalAttempts = paraCorrectKeys + paraErrorKeys;
  const paraAccuracy =
    paraTotalAttempts > 0
      ? Math.round((paraCorrectKeys / paraTotalAttempts) * 1000) / 10
      : 100;
  const paraRemainingDisplay =
    targetTimeSec !== null
      ? `${Math.max(0, Math.ceil(targetTimeSec - paraElapsedSec))}s`
      : `${Math.round((typedText.length / Math.max(1, paragraphText.length)) * 100)}%`;
  const maxParaChart = Math.max(60, ...paraWpmHistory, paraLiveWpm);

  // Derived Single-Word metrics
  const wordLiveWpm =
    wordElapsedSec > 0.4
      ? Math.max(0, Math.round(wordCorrectChars / 5 / (wordElapsedSec / 60)))
      : 0;
  const wordAccuracy =
    wordTotalChars > 0
      ? Math.round((wordCorrectChars / wordTotalChars) * 1000) / 10
      : 100;
  const currentWordBest = singleWordBests[difficulty];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Typing Speed & Accuracy
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Switch between full-paragraph WPM speed/accuracy and infinite single-word survival.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              setSectionTab('paragraph');
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sectionTab === 'paragraph'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Paragraph Typing
          </button>
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              setSectionTab('single-word');
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sectionTab === 'single-word'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Single-Word Survival
          </button>
        </div>
      </div>

      {sectionTab === 'paragraph' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              No punctuation or grammar rules · Press Tab to restart
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
              {(
                [
                  { id: 'full', label: 'Full Paragraph' },
                  { id: '30s', label: '30s' },
                  { id: '60s', label: '60s' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    resetParagraph(item.id);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paraMode === item.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Net WPM</div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
                {paraLiveWpm}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Accuracy</div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {paraAccuracy.toFixed(1)}
                <span className="ml-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">%</span>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {targetTimeSec !== null ? 'Time Remaining' : 'Paragraph Progress'}
              </div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {paraRemainingDisplay}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Personal Best</div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {bestRecord ? bestRecord.bestWpm : '—'}
                <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">WPM</span>
              </div>
            </div>
          </div>

          {paraPhase !== 'FINISHED' ? (
            <div
              ref={paraStageRef}
              tabIndex={0}
              role="textbox"
              aria-label="Paragraph typing prompt"
              onKeyDown={handleParagraphKeyDown}
              onFocus={() => setParaFocused(true)}
              onBlur={() => setParaFocused(false)}
              className={`relative bg-white dark:bg-slate-900 border rounded-xl p-8 outline-none transition-colors cursor-text ${
                paraFocused ? 'border-blue-400 dark:border-blue-500' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {!paraFocused && (
                <div className="mb-4 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 inline-block">
                  Click inside the paragraph box to resume typing focus
                </div>
              )}

              <p className="font-mono text-lg sm:text-xl leading-relaxed tracking-normal select-none break-words">
                {paragraphText.split('').map((char, idx) => {
                  const typedChar = typedText[idx];
                  let colorClass = 'text-slate-400 dark:text-slate-600';
                  if (typedChar !== undefined) {
                    colorClass =
                      typedChar === char
                        ? 'text-slate-900 dark:text-slate-100'
                        : char === ' '
                        ? 'bg-rose-200 dark:bg-rose-900/70 text-rose-800 dark:text-rose-200 rounded-xs'
                        : 'text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 rounded-xs';
                  }
                  const isCaret = idx === typedText.length;

                  return (
                    <span key={idx} className={`relative ${colorClass}`}>
                      {isCaret && paraFocused && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-0.5 bottom-0.5 w-0.5 accent-bg"
                        />
                      )}
                      {char}
                    </span>
                  );
                })}
              </p>

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Mistakes:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">{paraErrorKeys}</strong> ·
                  Characters:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {typedText.length}/{paragraphText.length}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => resetParagraph()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>New Paragraph</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
                    Paragraph Complete
                  </div>
                  <h2 className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {paraLiveWpm} WPM · {paraAccuracy.toFixed(1)}% Accuracy
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Raw WPM {paraRawWpm} · Correct {paraCorrectKeys} · Mistakes {paraErrorKeys}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => resetParagraph()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Next Paragraph</span>
                </button>
              </div>

              <div className="h-32 w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                {paraWpmHistory.length > 1 ? (
                  <svg
                    viewBox="0 0 600 100"
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                  >
                    <line
                      x1="0"
                      y1="50"
                      x2="600"
                      y2="50"
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="4 4"
                    />
                    <polyline
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={paraWpmHistory
                        .map((val, idx) => {
                          const x = (idx / (paraWpmHistory.length - 1)) * 600;
                          const y = 92 - (val / maxParaChart) * 82;
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  </svg>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                    WPM progression recorded across multi-second runs
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Difficulty Selector */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Infinite single-word rounds · Run ends after 3 failed keystrokes
            </span>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              {(['easy', 'medium', 'hard', 'extreme'] as const).map((diff) => (
                <button
                  key={diff}
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    resetSingleWord(diff);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    difficulty === diff
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {DIFFICULTY_META[diff].label} ({DIFFICULTY_META[diff].sample})
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Words Cleared</div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
                {wordsCleared}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Live WPM</div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {wordLiveWpm}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Lives Remaining</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((idx) => (
                    <Heart
                      key={idx}
                      className={`w-5 h-5 ${
                        idx < lives
                          ? 'text-rose-600 fill-rose-600'
                          : 'text-slate-300 dark:text-slate-700'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm font-mono font-bold tabular-nums text-slate-800 dark:text-slate-200">
                  {lives}/3
                </span>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {DIFFICULTY_META[difficulty].label} Best
              </div>
              <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {currentWordBest ? `${currentWordBest.wordsCleared}` : '—'}
                <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">words</span>
              </div>
            </div>
          </div>

          {wordPhase !== 'GAME_OVER' ? (
            <div
              ref={wordStageRef}
              tabIndex={0}
              role="textbox"
              aria-label="Single word survival input"
              onKeyDown={handleSingleWordKeyDown}
              onFocus={() => setWordFocused(true)}
              onBlur={() => setWordFocused(false)}
              className={`bg-white dark:bg-slate-900 border rounded-xl p-10 outline-none transition-colors cursor-text flex flex-col items-center justify-center min-h-72 gap-6 ${
                strikeBanner
                  ? 'border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20'
                  : wordFocused
                  ? 'border-blue-400 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {!wordFocused && (
                <div className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
                  Click inside this box to resume typing
                </div>
              )}

              <div className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Round {wordsCleared + 1} · {DIFFICULTY_META[difficulty].label} Mode
              </div>

              <div className="font-mono text-3xl sm:text-5xl font-bold tracking-tight text-center break-all select-none">
                {currentWord.split('').map((char, idx) => {
                  const typedChar = wordInput[idx];
                  const isTyped = typedChar !== undefined;
                  const isCaret = idx === wordInput.length;
                  return (
                    <span
                      key={idx}
                      className={`relative ${
                        isTyped ? 'accent-text' : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      {isCaret && wordFocused && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1 bottom-1 w-0.5 accent-bg"
                        />
                      )}
                      {char}
                    </span>
                  );
                })}
              </div>

              {strikeBanner ? (
                <div className="text-xs font-medium text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-lg px-3.5 py-2">
                  {strikeBanner}
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Type the word shown above (capitalization &amp; grammar ignored) · Accuracy{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {wordAccuracy.toFixed(1)}%
                  </strong>
                </div>
              )}

              <button
                type="button"
                onClick={() => resetSingleWord()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart Run</span>
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-rose-700 dark:text-rose-400 font-semibold">
                    3 Fails Reached · {DIFFICULTY_META[difficulty].label} Survival Ended
                  </div>
                  <h2 className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {wordsCleared} Words Cleared · {wordLiveWpm} WPM
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Accuracy {wordAccuracy.toFixed(1)}% · Time elapsed{' '}
                    {wordElapsedSec.toFixed(1)}s
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => resetSingleWord()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Play Again</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <GameLeaderboardPanel
        boardKey={
          sectionTab === 'paragraph'
            ? 'typing_paragraph'
            : (`typing_survival_${difficulty}` as BoardKey)
        }
        localPayload={
          sectionTab === 'paragraph'
            ? bestRecord
              ? typingParagraphToPayload(bestRecord)
              : null
            : singleWordBests[difficulty]
            ? singleWordToPayload(singleWordBests[difficulty]!)
            : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />
    </div>
  );
}
