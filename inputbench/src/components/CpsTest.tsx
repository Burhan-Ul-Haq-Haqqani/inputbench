import { Keyboard, RotateCcw, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import {
  BoardKey,
  cpsRecordToPayload,
  getCpsBoardKey,
} from '../data/leaderboards';
import { CpsBestRecord, CpsConfig, ModuleId } from '../types/benchmark';
import { formatKeyCode } from '../utils/storage';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';

interface CpsTestProps {
  config: CpsConfig;
  bestRecords: Record<number, CpsBestRecord>;
  onUpdateConfig: (next: CpsConfig) => void;
  onComplete: (record: CpsBestRecord, consistencyPct: number) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type CpsPhase = 'IDLE' | 'RUNNING' | 'FINISHED';
type BindingSlot = 'primary' | 'secondary' | null;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const DURATIONS = [1, 5, 10, 30];

export function CpsTest({
  config,
  bestRecords,
  onUpdateConfig,
  onComplete,
  onOpenLeaderboards,
}: CpsTestProps) {
  const [durationSec, setDurationSec] = useState<number>(5);
  const [phase, setPhase] = useState<CpsPhase>('IDLE');
  const [clicks, setClicks] = useState<number>(0);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [liveCps, setLiveCps] = useState<number>(0);
  const [peakCps, setPeakCps] = useState<number>(0);
  const [buckets, setBuckets] = useState<number[]>([]);
  const [consistencyPct, setConsistencyPct] = useState<number>(100);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [cooldownLocked, setCooldownLocked] = useState<boolean>(false);
  const [bindingSlot, setBindingSlot] = useState<BindingSlot>(null);
  const [bindMessage, setBindMessage] = useState<string | null>(null);

  const padRef = useRef<HTMLButtonElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const clickTimestampsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<CpsPhase>('IDLE');
  const durationRef = useRef<number>(durationSec);
  const peakCpsRef = useRef<number>(0);
  const rippleIdRef = useRef<number>(1);
  const cooldownLockedRef = useRef<boolean>(false);

  useEffect(() => {
    durationRef.current = durationSec;
  }, [durationSec]);

  useEffect(() => {
    cooldownLockedRef.current = cooldownLocked;
  }, [cooldownLocked]);

  const computeConsistency = (timestamps: number[]): number => {
    if (timestamps.length < 4) return 100;
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean <= 0) return 100;
    const variance =
      intervals.reduce((sum, val) => sum + (val - mean) ** 2, 0) / intervals.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.max(0, Math.min(100, Math.round((1 - Math.min(cv, 1)) * 100)));
  };

  const finishTest = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    phaseRef.current = 'FINISHED';
    setPhase('FINISHED');
    cooldownLockedRef.current = true;
    setCooldownLocked(true);
    window.setTimeout(() => {
      cooldownLockedRef.current = false;
      setCooldownLocked(false);
    }, 650);

    const dur = durationRef.current;
    const totalClicks = clickTimestampsRef.current.length;
    const avgCps = totalClicks / dur;
    setElapsedMs(dur * 1000);
    setLiveCps(avgCps);

    const sliceCount = Math.min(20, Math.max(10, dur * 2));
    const sliceMs = (dur * 1000) / sliceCount;
    const counts = new Array<number>(sliceCount).fill(0);
    for (const ts of clickTimestampsRef.current) {
      const idx = Math.min(sliceCount - 1, Math.floor((ts - startTimeRef.current) / sliceMs));
      if (idx >= 0) counts[idx]++;
    }
    const cpsCurve = counts.map((c) => c / (sliceMs / 1000));
    setBuckets(cpsCurve);

    const computedPeak = Math.max(peakCpsRef.current, ...cpsCurve, avgCps);
    setPeakCps(computedPeak);

    const cons = computeConsistency(clickTimestampsRef.current);
    setConsistencyPct(cons);

    sfx.playLevelComplete();

    onComplete(
      {
        bestCps: Math.round(avgCps * 100) / 100,
        durationSec: dur,
        totalClicks,
        achievedAt: Date.now(),
      },
      cons
    );
  }, [onComplete]);

  const tick = useCallback(() => {
    if (phaseRef.current !== 'RUNNING') return;
    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    const totalMs = durationRef.current * 1000;

    if (elapsed >= totalMs) {
      finishTest();
      return;
    }

    setElapsedMs(elapsed);

    const recentWindowStart = now - 1000;
    const recentClicks = clickTimestampsRef.current.filter((t) => t >= recentWindowStart).length;
    const rolling =
      elapsed < 1000
        ? (clickTimestampsRef.current.length / Math.max(elapsed, 120)) * 1000
        : recentClicks;
    setLiveCps(rolling);
    if (rolling > peakCpsRef.current) {
      peakCpsRef.current = rolling;
      setPeakCps(rolling);
    }

    const sliceCount = 12;
    const sliceMs = totalMs / sliceCount;
    const counts = new Array<number>(sliceCount).fill(0);
    for (const ts of clickTimestampsRef.current) {
      const idx = Math.min(sliceCount - 1, Math.floor((ts - startTimeRef.current) / sliceMs));
      if (idx >= 0) counts[idx]++;
    }
    setBuckets(counts.map((c) => c / (sliceMs / 1000)));

    rafRef.current = requestAnimationFrame(tick);
  }, [finishTest]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const resetTest = useCallback((newDuration?: number) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (typeof newDuration === 'number') {
      setDurationSec(newDuration);
      durationRef.current = newDuration;
    }
    phaseRef.current = 'IDLE';
    clickTimestampsRef.current = [];
    peakCpsRef.current = 0;
    setPhase('IDLE');
    setClicks(0);
    setElapsedMs(0);
    setLiveCps(0);
    setPeakCps(0);
    setBuckets([]);
    setConsistencyPct(100);
    setRipples([]);
  }, []);

  const triggerHit = useCallback(
    (x: number, y: number) => {
      if (phaseRef.current === 'FINISHED') {
        if (!cooldownLockedRef.current) resetTest();
        return;
      }

      const now = performance.now();
      const rid = rippleIdRef.current++;
      setRipples((prev) => [...prev.slice(-5), { id: rid, x, y }]);
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== rid));
      }, 320);

      if (phaseRef.current === 'IDLE') {
        startTimeRef.current = now;
        clickTimestampsRef.current = [now];
        phaseRef.current = 'RUNNING';
        setPhase('RUNNING');
        setClicks(1);
        setElapsedMs(0);
        sfx.playLevelStart();
        sfx.playClickPop();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (phaseRef.current === 'RUNNING') {
        clickTimestampsRef.current.push(now);
        setClicks(clickTimestampsRef.current.length);
        sfx.playClickPop();
      }
    },
    [resetTest, tick]
  );

  const handlePadPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (bindingSlot !== null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    triggerHit(e.clientX - rect.left, e.clientY - rect.top);
  };

  // Keybind capture listener
  useEffect(() => {
    if (bindingSlot === null) return;

    const handleBindKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        setBindingSlot(null);
        setBindMessage(null);
        return;
      }

      const otherKey = bindingSlot === 'primary' ? config.secondaryKey : config.primaryKey;
      if (otherKey && e.code === otherKey) {
        setBindMessage('Primary and Secondary keys must be different.');
        return;
      }

      const nextConfig: CpsConfig = {
        ...config,
        primaryKey: bindingSlot === 'primary' ? e.code : config.primaryKey,
        secondaryKey: bindingSlot === 'secondary' ? e.code : config.secondaryKey,
      };
      onUpdateConfig(nextConfig);
      setBindingSlot(null);
      setBindMessage(null);
    };

    window.addEventListener('keydown', handleBindKeyDown, true);
    return () => window.removeEventListener('keydown', handleBindKeyDown, true);
  }, [bindingSlot, config, onUpdateConfig]);

  // Active CPS keybind listener (ignores OS auto-repeat so holding a key never cheats)
  useEffect(() => {
    if (bindingSlot !== null) return;

    const handleKeyHit = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const isPrimary = config.primaryKey !== null && e.code === config.primaryKey;
      const isSecondary = config.secondaryKey !== null && e.code === config.secondaryKey;
      if (!isPrimary && !isSecondary) return;

      // Avoid hijacking keyboard when typing inside a focused control other than the pad
      const activeTag = document.activeElement?.tagName;
      if (
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT'
      ) {
        return;
      }

      e.preventDefault();

      const rect = padRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width * (isSecondary ? 0.62 : isPrimary && config.secondaryKey ? 0.38 : 0.5) : 200;
      const cy = rect ? rect.height * 0.5 : 140;
      triggerHit(cx, cy);
    };

    window.addEventListener('keydown', handleKeyHit);
    return () => window.removeEventListener('keydown', handleKeyHit);
  }, [bindingSlot, config.primaryKey, config.secondaryKey, triggerHit]);

  const timeRemainingSec = Math.max(0, durationSec - elapsedMs / 1000);
  const currentBest = bestRecords[durationSec];
  const avgCps = clicks / durationSec;
  const maxChartVal = Math.max(10, ...buckets, 1);

  const boundKeysSummary = [
    config.primaryKey ? formatKeyCode(config.primaryKey) : null,
    config.secondaryKey ? formatKeyCode(config.secondaryKey) : null,
  ].filter(Boolean);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Clicks Per Second (CPS)
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Click inside the pad or tap your bound keys to start. Held key-repeat is ignored.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          {DURATIONS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                resetTest(sec);
              }}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                durationSec === sec
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* Keybind Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Keyboard className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Keyboard Click Binds</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Use single key or dual-key alternating alongside mouse clicks
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden">
            <button
              type="button"
              disabled={phase === 'RUNNING'}
              onClick={() => {
                setBindMessage(null);
                setBindingSlot(bindingSlot === 'primary' ? null : 'primary');
              }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                bindingSlot === 'primary'
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">Key 1:</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {bindingSlot === 'primary'
                  ? 'Press key...'
                  : config.primaryKey
                  ? formatKeyCode(config.primaryKey)
                  : 'Unbound'}
              </span>
            </button>
            {config.primaryKey && phase !== 'RUNNING' && (
              <button
                type="button"
                aria-label="Clear primary keybind"
                onClick={() => onUpdateConfig({ ...config, primaryKey: null })}
                className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border-l border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden">
            <button
              type="button"
              disabled={phase === 'RUNNING'}
              onClick={() => {
                setBindMessage(null);
                setBindingSlot(bindingSlot === 'secondary' ? null : 'secondary');
              }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                bindingSlot === 'secondary'
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">Key 2:</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {bindingSlot === 'secondary'
                  ? 'Press key...'
                  : config.secondaryKey
                  ? formatKeyCode(config.secondaryKey)
                  : 'Optional'}
              </span>
            </button>
            {config.secondaryKey && phase !== 'RUNNING' && (
              <button
                type="button"
                aria-label="Clear secondary keybind"
                onClick={() => onUpdateConfig({ ...config, secondaryKey: null })}
                className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border-l border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {bindMessage && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3.5 py-2">
          {bindMessage}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Time Remaining</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {timeRemainingSec.toFixed(2)}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">s</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Clicks</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {clicks}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {phase === 'FINISHED' ? 'Average CPS' : 'Live CPS'}
          </div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
            {(phase === 'FINISHED' ? avgCps : liveCps).toFixed(2)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{durationSec}s Personal Best</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {currentBest ? currentBest.bestCps.toFixed(2) : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">CPS</span>
          </div>
        </div>
      </div>

      <button
        ref={padRef}
        type="button"
        data-no-global-pulse="true"
        onPointerDown={handlePadPointerDown}
        onKeyDown={(e) => {
          if (e.code === 'Space' || e.code === 'Enter') e.preventDefault();
        }}
        className={`relative w-full h-72 rounded-xl border transition-all active:scale-[0.995] overflow-hidden select-none flex flex-col items-center justify-center gap-2 cursor-crosshair focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          phase === 'RUNNING'
            ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-400 dark:border-blue-500'
            : phase === 'FINISHED'
            ? 'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
        }`}
      >
        {ripples.map((r) => (
          <span
            key={r.id}
            style={{ left: r.x, top: r.y }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border-2 border-blue-500/45 animate-ping"
          />
        ))}

        {phase === 'IDLE' && (
          <>
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Click pad{boundKeysSummary.length > 0 ? ` or press ${boundKeysSummary.join(' / ')}` : ''} to start
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {durationSec}-second interval · Pointer & custom keyboard input
            </span>
          </>
        )}

        {phase === 'RUNNING' && (
          <>
            <span className="text-5xl font-mono font-bold tabular-nums accent-text">
              {clicks}
            </span>
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Keep clicking</span>
          </>
        )}

        {phase === 'FINISHED' && (
          <>
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
              Interval Complete
            </span>
            <span className="text-4xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {avgCps.toFixed(2)} CPS
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {cooldownLocked ? 'Recording result...' : 'Click pad or press Reset to run again'}
            </span>
          </>
        )}
      </button>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Click Rate Telemetry</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Clicks per second across time slices · Peak {peakCps.toFixed(2)} CPS · Consistency{' '}
              {consistencyPct}%
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              resetTest();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Test</span>
          </button>
        </div>

        <div className="h-28 w-full bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
          {buckets.length > 0 ? (
            <svg viewBox="0 0 600 90" className="w-full h-full overflow-visible" preserveAspectRatio="none">
              <line x1="0" y1="45" x2="600" y2="45" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="4 4" />
              <polyline
                fill="none"
                stroke="var(--accent-primary)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={buckets
                  .map((val, idx) => {
                    const x = buckets.length === 1 ? 300 : (idx / (buckets.length - 1)) * 600;
                    const y = 84 - (val / maxChartVal) * 76;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />
            </svg>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
              Click-rate curve will plot live during your test run
            </div>
          )}
        </div>
      </div>

      <GameLeaderboardPanel
        boardKey={getCpsBoardKey(durationSec)}
        localPayload={currentBest ? cpsRecordToPayload(currentBest) : null}
        onOpenFullLeaderboards={onOpenLeaderboards}
      />
    </div>
  );
}
