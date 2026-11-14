import { AlertTriangle, CheckCircle2, Clock, RotateCcw, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import {
  BoardKey,
  getReactionBoardKey,
  reactionRecordToPayload,
} from '../data/leaderboards';
import { ModuleId, ReactionBestRecord } from '../types/benchmark';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';

interface ReactionTestProps {
  bestRecord: ReactionBestRecord | null;
  onComplete: (record: ReactionBestRecord, medianMs: number) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type ReactionPhase =
  | 'IDLE'
  | 'WAITING'
  | 'GO'
  | 'EARLY_FAULT'
  | 'ROUND_RESULT'
  | 'SUMMARY';

const ROUND_OPTIONS = [3, 5, 10];

export function ReactionTest({
  bestRecord,
  onComplete,
  onOpenLeaderboards,
}: ReactionTestProps) {
  const [totalRounds, setTotalRounds] = useState<number>(5);
  const [phase, setPhase] = useState<ReactionPhase>('IDLE');
  const [roundResults, setRoundResults] = useState<number[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const goTimeRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleNextCue = useCallback(() => {
    clearTimers();
    setPhase('WAITING');
    const delayMs = 1500 + Math.random() * 2600;
    timerRef.current = window.setTimeout(() => {
      rafRef.current = requestAnimationFrame(() => {
        goTimeRef.current = performance.now();
        setPhase('GO');
        sfx.playReactionCue();
      });
    }, delayMs);
  }, [clearTimers]);

  const resetAll = useCallback(
    (nextRounds?: number) => {
      clearTimers();
      if (typeof nextRounds === 'number') setTotalRounds(nextRounds);
      setRoundResults([]);
      setLastMs(null);
      setPhase('IDLE');
    },
    [clearTimers]
  );

  const handlePadPointerDown = () => {
    if (phase === 'IDLE') {
      setRoundResults([]);
      setLastMs(null);
      sfx.playLevelStart();
      scheduleNextCue();
      return;
    }

    if (phase === 'WAITING') {
      clearTimers();
      setPhase('EARLY_FAULT');
      sfx.playDeath();
      return;
    }

    if (phase === 'EARLY_FAULT') {
      sfx.playUiTick();
      scheduleNextCue();
      return;
    }

    if (phase === 'GO') {
      const delta = Math.max(1, Math.round(performance.now() - goTimeRef.current));
      const updated = [...roundResults, delta];
      setLastMs(delta);
      setRoundResults(updated);

      if (updated.length >= totalRounds) {
        setPhase('SUMMARY');
        sfx.playLevelComplete();
        const avg = updated.reduce((a, b) => a + b, 0) / updated.length;
        const sorted = [...updated].sort((a, b) => a - b);
        const median =
          sorted.length % 2 === 1
            ? sorted[Math.floor(sorted.length / 2)]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const bestSingle = sorted[0];
        onComplete(
          {
            bestAverageMs: Math.round(avg * 10) / 10,
            bestSingleMs: bestSingle,
            rounds: totalRounds,
            achievedAt: Date.now(),
          },
          Math.round(median)
        );
      } else {
        sfx.playReactionHit();
        setPhase('ROUND_RESULT');
      }
      return;
    }

    if (phase === 'ROUND_RESULT') {
      sfx.playUiTick();
      scheduleNextCue();
      return;
    }

    if (phase === 'SUMMARY') {
      resetAll();
      sfx.playLevelStart();
      scheduleNextCue();
    }
  };

  const currentAvg =
    roundResults.length > 0
      ? Math.round(roundResults.reduce((a, b) => a + b, 0) / roundResults.length)
      : null;

  const sorted = [...roundResults].sort((a, b) => a - b);
  const medianMs =
    sorted.length > 0
      ? sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : null;
  const maxBarMs = Math.max(350, ...roundResults);

  const stageStyles: Record<ReactionPhase, string> = {
    IDLE: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500',
    WAITING: 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700',
    GO: 'bg-emerald-600 border-emerald-700 text-white',
    EARLY_FAULT: 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700',
    ROUND_RESULT: 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700',
    SUMMARY: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Reaction Time</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Click immediately when the signal turns green. Clicking during the wait state registers a false start.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          {ROUND_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                resetAll(count);
              }}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                totalRounds === count
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {count} Rounds
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Trial Progress</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {roundResults.length}/{totalRounds}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Last Trial</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {lastMs !== null ? lastMs : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">ms</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Session Average</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
            {currentAvg !== null ? currentAvg : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">ms</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Personal Best Avg</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {bestRecord ? Math.round(bestRecord.bestAverageMs) : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">ms</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        data-no-global-pulse="true"
        onPointerDown={handlePadPointerDown}
        className={`w-full h-80 rounded-xl border transition-all active:scale-[0.995] select-none flex flex-col items-center justify-center gap-3 px-6 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${stageStyles[phase]}`}
      >
        {phase === 'IDLE' && (
          <>
            <Zap className="w-8 h-8 accent-text" />
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">Click to start Trial 1</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {totalRounds} randomized visual cue rounds
            </span>
          </>
        )}

        {phase === 'WAITING' && (
          <>
            <Clock className="w-8 h-8 text-amber-700 dark:text-amber-400" />
            <span className="text-2xl font-bold text-amber-900 dark:text-amber-200">Wait for Green Signal</span>
            <span className="text-sm text-amber-800 dark:text-amber-300">Hold steady — do not click early</span>
          </>
        )}

        {phase === 'GO' && (
          <>
            <CheckCircle2 className="w-10 h-10 text-white" />
            <span className="text-3xl font-bold text-white">Click Now!</span>
          </>
        )}

        {phase === 'EARLY_FAULT' && (
          <>
            <AlertTriangle className="w-8 h-8 text-rose-600 dark:text-rose-400" />
            <span className="text-2xl font-bold text-rose-900 dark:text-rose-200">Too Early — False Start</span>
            <span className="text-sm text-rose-700 dark:text-rose-300">Click anywhere inside to retry this round</span>
          </>
        )}

        {phase === 'ROUND_RESULT' && (
          <>
            <span className="text-xs font-mono uppercase tracking-wider text-blue-700 dark:text-blue-400 font-semibold">
              Round {roundResults.length} Recorded
            </span>
            <span className="text-5xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {lastMs} ms
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Click anywhere inside to begin Round {roundResults.length + 1}
            </span>
          </>
        )}

        {phase === 'SUMMARY' && (
          <>
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
              Benchmark Complete
            </span>
            <span className="text-4xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {currentAvg} ms avg
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Median {medianMs} ms · Fastest {sorted[0]} ms · Click to run another set
            </span>
          </>
        )}
      </button>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Per-Round Latency Breakdown</h2>
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              resetAll();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>

        {roundResults.length > 0 ? (
          <div className="space-y-2.5">
            {roundResults.map((ms, idx) => {
              const pct = Math.min(100, Math.round((ms / maxBarMs) * 100));
              const isFastest = ms === sorted[0];
              return (
                <div key={idx} className="flex items-center gap-4">
                  <span className="w-16 text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                    Trial {idx + 1}
                  </span>
                  <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full transition-all duration-300 ${
                        isFastest ? 'bg-emerald-600' : 'accent-bg'
                      }`}
                    />
                  </div>
                  <span className="w-20 text-right text-xs font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                    {ms} ms
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Completed trial latencies will appear here after each round.
          </p>
        )}
      </div>

      <GameLeaderboardPanel
        boardKey={getReactionBoardKey(totalRounds)}
        localPayload={
          bestRecord && bestRecord.rounds === totalRounds
            ? reactionRecordToPayload(bestRecord)
            : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />
    </div>
  );
}
