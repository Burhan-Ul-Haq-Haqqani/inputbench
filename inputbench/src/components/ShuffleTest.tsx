import {
  CheckCircle2,
  CircleDot,
  ImagePlus,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import { BoardKey, shuffleRecordToPayload } from '../data/leaderboards';
import {
  ModuleId,
  ShuffleBestRecord,
  ShuffleDifficulty,
} from '../types/benchmark';
import {
  deleteMediaAsset,
  loadMediaAsset,
  readFileAsDataUrl,
  saveMediaAsset,
  StoredMediaAsset,
} from '../utils/mediaStorage';
import { checkPolicyContent } from '../utils/policyGuard';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';
import { PasswordConfirmModal } from './PasswordConfirmModal';

interface ShuffleTestProps {
  bestRecords: Partial<Record<ShuffleDifficulty, ShuffleBestRecord>>;
  lowDetailMode: boolean;
  onComplete: (record: ShuffleBestRecord) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type ShufflePhase = 'READY' | 'REVEAL' | 'SHUFFLING' | 'GUESSING' | 'RESULT';

interface SwapPair {
  cupA: number;
  cupB: number;
  slotA: number;
  slotB: number;
}

const DIFFICULTY_META: Record<
  ShuffleDifficulty,
  {
    label: string;
    cups: number;
    baseSwaps: number;
    swapMs: number;
    description: string;
  }
> = {
  easy: {
    label: 'Easy',
    cups: 2,
    baseSwaps: 7,
    swapMs: 360,
    description: '2 cups · Clear approachable swaps',
  },
  medium: {
    label: 'Medium',
    cups: 5,
    baseSwaps: 12,
    swapMs: 280,
    description: '5 cups · Moderate cross-swaps',
  },
  hard: {
    label: 'Hard',
    cups: 10,
    baseSwaps: 18,
    swapMs: 225,
    description: '10 cups · High-speed shell shuffle',
  },
};

function cropStaticImageToCircleDataUrl(
  srcDataUrl: string,
  zoom = 1
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const minDim = Math.min(img.naturalWidth, img.naturalHeight);
      const cropSide = minDim / Math.max(1, zoom);
      const sx = (img.naturalWidth - cropSide) / 2;
      const sy = (img.naturalHeight - cropSide) / 2;

      ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, size, size);
      ctx.restore();

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for circle crop'));
    img.src = srcDataUrl;
  });
}

export function ShuffleTest({
  bestRecords,
  lowDetailMode,
  onComplete,
  onOpenLeaderboards,
}: ShuffleTestProps) {
  const [difficulty, setDifficulty] = useState<ShuffleDifficulty>('easy');
  const [phase, setPhase] = useState<ShufflePhase>('READY');
  const [cupSlots, setCupSlots] = useState<number[]>(() => [0, 1]);
  const [ballCupId, setBallCupId] = useState<number>(0);
  const [guessedCupId, setGuessedCupId] = useState<number | null>(null);
  const [isCorrectGuess, setIsCorrectGuess] = useState<boolean | null>(null);
  const [streak, setStreak] = useState<number>(0);
  const [totalCorrect, setTotalCorrect] = useState<number>(0);
  const [roundNum, setRoundNum] = useState<number>(1);
  const [stageWidth, setStageWidth] = useState<number>(760);

  const { triggerBan, parentalControls } = useFirebase();
  const customMediaAllowed = parentalControls?.allowCustomMedia !== false;
  const [ballAsset, setBallAsset] = useState<StoredMediaAsset | null>(null);
  const [rawBallSourceUrl, setRawBallSourceUrl] = useState<string | null>(null);
  const [circleZoom, setCircleZoom] = useState<number>(1);
  const [ballError, setBallError] = useState<string | null>(null);
  const [confirmResetModal, setConfirmResetModal] = useState<boolean>(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const cupElRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const cupsCount = DIFFICULTY_META[difficulty].cups;
  const currentBest = bestRecords[difficulty];

  const clearTimers = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadMediaAsset('shuffle_ball').then((asset) => {
      if (asset) {
        setBallAsset(asset);
        setRawBallSourceUrl(asset.dataUrl);
      }
    });
    return clearTimers;
  }, [clearTimers]);

  useEffect(() => {
    const updateWidth = () => {
      if (stageRef.current) {
        setStageWidth(stageRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const getSlotCenterX = useCallback(
    (slotIdx: number, count: number, width: number) => {
      const paddingX = count >= 10 ? 28 : count >= 5 ? 48 : 96;
      const usable = Math.max(200, width - paddingX * 2);
      return paddingX + ((slotIdx + 0.5) / count) * usable;
    },
    []
  );

  const resetForDifficulty = useCallback(
    (nextDiff: ShuffleDifficulty) => {
      clearTimers();
      const count = DIFFICULTY_META[nextDiff].cups;
      setDifficulty(nextDiff);
      setPhase('READY');
      setCupSlots(Array.from({ length: count }, (_, i) => i));
      setBallCupId(Math.floor(Math.random() * count));
      setGuessedCupId(null);
      setIsCorrectGuess(null);
      setStreak(0);
      setTotalCorrect(0);
      setRoundNum(1);
    },
    [clearTimers]
  );

  const applyCupTransform = useCallback(
    (cupId: number, xCenterPx: number, yOffsetPx: number, zIndex: number) => {
      const el = cupElRefs.current[cupId];
      if (!el) return;
      el.style.transform = `translate3d(${xCenterPx}px, ${yOffsetPx}px, 0) translateX(-50%)`;
      el.style.zIndex = String(zIndex);
    },
    []
  );

  // Keep static cup transforms aligned when not mid-RAF swap
  useEffect(() => {
    if (phase === 'SHUFFLING') return;
    const width = stageRef.current?.clientWidth || stageWidth;
    for (let cupId = 0; cupId < cupsCount; cupId++) {
      const slot = cupSlots[cupId] ?? cupId;
      const cx = getSlotCenterX(slot, cupsCount, width);
      let lift = 0;
      if (phase === 'REVEAL' && cupId === ballCupId) {
        lift = -66;
      } else if (phase === 'RESULT') {
        if (cupId === guessedCupId || cupId === ballCupId) {
          lift = -66;
        }
      }
      applyCupTransform(cupId, cx, lift, 10 + cupId);
    }
  }, [
    applyCupTransform,
    ballCupId,
    cupSlots,
    cupsCount,
    getSlotCenterX,
    guessedCupId,
    phase,
    stageWidth,
  ]);

  const runShuffleSequence = useCallback(
    (initialSlots: number[], targetBallCup: number, currentRound: number) => {
      const meta = DIFFICULTY_META[difficulty];
      const count = meta.cups;
      const totalSwaps = meta.baseSwaps + Math.min(6, Math.floor((currentRound - 1) / 2));
      const swapDuration = Math.max(
        165,
        meta.swapMs - Math.min(55, (currentRound - 1) * 8)
      );

      // Build randomized swap plan
      const workingSlots = [...initialSlots];
      const swaps: SwapPair[] = [];
      let prevKey = '';

      for (let s = 0; s < totalSwaps; s++) {
        let cupA = Math.floor(Math.random() * count);
        let cupB = Math.floor(Math.random() * count);

        // Bias frequently toward swapping the ball cup so it genuinely moves
        if (count > 2 && Math.random() < 0.6) {
          cupA = targetBallCup;
        }

        while (cupB === cupA) {
          cupB = Math.floor(Math.random() * count);
        }

        const pairKey = cupA < cupB ? `${cupA}-${cupB}` : `${cupB}-${cupA}`;
        if (count > 2 && pairKey === prevKey) {
          cupB = (cupA + 1 + Math.floor(Math.random() * (count - 1))) % count;
        }
        prevKey = cupA < cupB ? `${cupA}-${cupB}` : `${cupB}-${cupA}`;

        const slotA = workingSlots[cupA];
        const slotB = workingSlots[cupB];
        workingSlots[cupA] = slotB;
        workingSlots[cupB] = slotA;
        swaps.push({ cupA, cupB, slotA, slotB });
      }

      setPhase('SHUFFLING');

      const width = stageRef.current?.clientWidth || stageWidth;
      let swapIdx = 0;
      let swapStartMs = performance.now();
      sfx.playKeyTap();

      const stepSwap = (nowMs: number) => {
        const elapsed = nowMs - swapStartMs;
        const p = Math.min(1, elapsed / swapDuration);
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
        const active = swaps[swapIdx];

        const xA = getSlotCenterX(active.slotA, count, width);
        const xB = getSlotCenterX(active.slotB, count, width);
        const arcH = count >= 10 ? 34 : 46;
        const liftSin = Math.sin(Math.PI * p) * arcH;

        const currXA = xA + (xB - xA) * eased;
        const currXB = xB + (xA - xB) * eased;

        applyCupTransform(active.cupA, currXA, -liftSin, 30);
        applyCupTransform(active.cupB, currXB, liftSin, 20);

        if (p >= 1) {
          swapIdx++;
          if (swapIdx >= swaps.length) {
            setCupSlots(workingSlots);
            setPhase('GUESSING');
            rafRef.current = null;
            return;
          }
          swapStartMs = nowMs;
          sfx.playKeyTap();
        }

        rafRef.current = requestAnimationFrame(stepSwap);
      };

      rafRef.current = requestAnimationFrame(stepSwap);
    },
    [applyCupTransform, difficulty, getSlotCenterX, stageWidth]
  );

  const startRound = useCallback(
    (nextRoundNumber = 1, keepStreak = true) => {
      clearTimers();
      const count = DIFFICULTY_META[difficulty].cups;
      const freshSlots = Array.from({ length: count }, (_, i) => i);
      const chosenBallCup = Math.floor(Math.random() * count);

      if (!keepStreak) {
        setStreak(0);
        setTotalCorrect(0);
      }
      setRoundNum(nextRoundNumber);
      setCupSlots(freshSlots);
      setBallCupId(chosenBallCup);
      setGuessedCupId(null);
      setIsCorrectGuess(null);
      setPhase('REVEAL');
      sfx.playLevelStart();

      // Lift cup to reveal ball, lower it back, then shuffle
      timerRef.current = window.setTimeout(() => {
        setPhase('SHUFFLING');
        const width = stageRef.current?.clientWidth || stageWidth;
        for (let i = 0; i < count; i++) {
          applyCupTransform(i, getSlotCenterX(freshSlots[i], count, width), 0, 10 + i);
        }
        timerRef.current = window.setTimeout(() => {
          runShuffleSequence(freshSlots, chosenBallCup, nextRoundNumber);
        }, 280);
      }, 900);
    },
    [applyCupTransform, clearTimers, difficulty, getSlotCenterX, runShuffleSequence, stageWidth]
  );

  const handleCupPick = (cupId: number) => {
    if (phase !== 'GUESSING') return;
    setGuessedCupId(cupId);
    const correct = cupId === ballCupId;
    setIsCorrectGuess(correct);
    setPhase('RESULT');

    if (correct) {
      const nextStreak = streak + 1;
      const nextTotal = totalCorrect + 1;
      setStreak(nextStreak);
      setTotalCorrect(nextTotal);
      sfx.playWordClear();

      onComplete({
        difficulty,
        cupsCount,
        bestStreak: nextStreak,
        totalCorrect: nextTotal,
        achievedAt: Date.now(),
      });
    } else {
      sfx.playDeath();
      if (streak > 0) {
        onComplete({
          difficulty,
          cupsCount,
          bestStreak: streak,
          totalCorrect,
          achievedAt: Date.now(),
        });
      }
    }
  };

  const handleBallUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!customMediaAllowed) {
      setBallError('Custom ball uploads are disabled by Parental Controls.');
      return;
    }

    setBallError(null);
    if (!checkPolicyContent(file.name).allowed) {
      setBallError('Explicit/offensive images violate Policy Agreements.');
      await triggerBan(
        'Policy violation: attempted to upload explicit ball icon.',
        'Policy violation ban'
      );
      return;
    }

    const isGif =
      file.type.toLowerCase() === 'image/gif' || /\.gif$/i.test(file.name);
    const isSupported =
      ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(
        file.type.toLowerCase()
      ) || /\.(png|jpe?g|gif)$/i.test(file.name);

    if (!isSupported) {
      setBallError('Please choose a PNG, JPG, JPEG, or GIF image.');
      return;
    }

    try {
      const rawUrl = await readFileAsDataUrl(file);
      setRawBallSourceUrl(rawUrl);

      // For static PNG/JPG/JPEG, physically cut outside the perfect circle into transparent PNG!
      // For animated GIFs, preserve full animation and clip cleanly via perfect circular mask.
      const processedUrl = isGif
        ? rawUrl
        : await cropStaticImageToCircleDataUrl(rawUrl, circleZoom);

      const asset: StoredMediaAsset = {
        dataUrl: processedUrl,
        fileName: file.name,
        mimeType: isGif ? 'image/gif' : 'image/png',
        updatedAt: Date.now(),
      };
      setBallAsset(asset);
      await saveMediaAsset('shuffle_ball', asset);
    } catch {
      setBallError('Unable to process that image file.');
    }
  };

  const handleZoomChange = async (nextZoom: number) => {
    setCircleZoom(nextZoom);
    if (!ballAsset || !rawBallSourceUrl) return;
    if (ballAsset.mimeType !== 'image/gif') {
      try {
        const reCropped = await cropStaticImageToCircleDataUrl(
          rawBallSourceUrl,
          nextZoom
        );
        const updated: StoredMediaAsset = {
          ...ballAsset,
          dataUrl: reCropped,
          updatedAt: Date.now(),
        };
        setBallAsset(updated);
        await saveMediaAsset('shuffle_ball', updated);
      } catch {
        // Ignore transient crop issues
      }
    }
  };

  const resetBallIcon = async () => {
    setBallAsset(null);
    setRawBallSourceUrl(null);
    setCircleZoom(1);
    await deleteMediaAsset('shuffle_ball');
    setConfirmResetModal(false);
  };

  const ballSlot = cupSlots[ballCupId] ?? 0;
  const ballCenterX = getSlotCenterX(ballSlot, cupsCount, stageWidth);
  const showBall = phase === 'REVEAL' || phase === 'RESULT';

  const cupSizeClass =
    cupsCount === 10
      ? 'w-11 h-16 sm:w-14 sm:h-20'
      : cupsCount === 5
      ? 'w-20 h-24 sm:w-24 sm:h-28'
      : 'w-24 h-32 sm:w-28 sm:h-36';

  const ballSizeClass =
    cupsCount === 10
      ? 'w-8 h-8 sm:w-10 sm:h-10'
      : cupsCount === 5
      ? 'w-12 h-12 sm:w-14 sm:h-14'
      : 'w-14 h-14 sm:w-16 sm:h-16';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Ball Shuffle
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Track the ball across {cupsCount} cups ({DIFFICULTY_META[difficulty].label} mode) and pick the right cup after the shuffle.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          {(['easy', 'medium', 'hard'] as const).map((diff) => (
            <button
              key={diff}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                resetForDifficulty(diff);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                difficulty === diff
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {DIFFICULTY_META[diff].label} ({DIFFICULTY_META[diff].cups} Cups)
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Cups</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {cupsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Round</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            #{roundNum}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Current Streak</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
            {streak}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {DIFFICULTY_META[difficulty].label} Best Streak
          </div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {currentBest ? currentBest.bestStreak : '—'}
          </div>
        </div>
      </div>

      {/* Shuffle Arena Stage */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {phase === 'READY' && `Ready · ${DIFFICULTY_META[difficulty].description}`}
            {phase === 'REVEAL' && 'Watch closely — memorizing ball position...'}
            {phase === 'SHUFFLING' && 'Shuffling cups... keep your eyes on the ball!'}
            {phase === 'GUESSING' && 'Which cup hides the ball? Click a cup to reveal!'}
            {phase === 'RESULT' &&
              (isCorrectGuess
                ? `Correct! Streak ${streak} — speed increases slightly each round.`
                : `Missed! The ball was under cup #${ballSlot + 1}.`)}
          </div>

          {phase === 'READY' && (
            <button
              type="button"
              onClick={() => startRound(1, false)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Start Shuffle</span>
            </button>
          )}

          {phase === 'RESULT' && isCorrectGuess && (
            <button
              type="button"
              onClick={() => startRound(roundNum + 1, true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Next Round (#{roundNum + 1})</span>
            </button>
          )}

          {phase === 'RESULT' && !isCorrectGuess && (
            <button
              type="button"
              onClick={() => startRound(1, false)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Play Again</span>
            </button>
          )}
        </div>

        {/* Table & Cup Area */}
        <div
          ref={stageRef}
          className="relative w-full h-72 sm:h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden select-none"
        >
          {/* Table surface line */}
          <div className="absolute inset-x-0 bottom-8 h-px bg-slate-200 dark:bg-slate-800" />
          <div className="absolute inset-x-0 bottom-0 h-8 bg-slate-100/80 dark:bg-slate-900/80" />

          {/* The Ball (perfect circle mask, cropped cleanly for PNG/JPG/JPEG and animated GIF) */}
          <div
            style={{
              transform: `translate3d(${ballCenterX}px, 0, 0) translateX(-50%)`,
              opacity: showBall ? 1 : 0,
            }}
            className="pointer-events-none absolute left-0 bottom-9 z-[5] transition-opacity duration-150"
          >
            <div
              className={`${ballSizeClass} aspect-square rounded-full overflow-hidden border-2 border-white dark:border-slate-800 shadow-md flex items-center justify-center ${
                ballAsset && customMediaAllowed ? 'bg-slate-900' : 'accent-bg'
              }`}
            >
              {ballAsset && customMediaAllowed ? (
                <img
                  src={ballAsset.dataUrl}
                  alt="Shuffle ball"
                  style={
                    ballAsset.mimeType === 'image/gif'
                      ? { transform: `scale(${circleZoom})` }
                      : undefined
                  }
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <div className="w-full h-full relative">
                  <div className="absolute top-1.5 left-1.5 w-1/3 h-1/3 rounded-full bg-white/45 blur-[1px]" />
                </div>
              )}
            </div>
          </div>

          {/* Cups */}
          {Array.from({ length: cupsCount }, (_, cupId) => {
            const isPicked = guessedCupId === cupId;
            const isBallCup = ballCupId === cupId;
            const slotNum = (cupSlots[cupId] ?? cupId) + 1;
            const isGuessable = phase === 'GUESSING';

            let cupTone =
              'from-slate-700 to-slate-900 dark:from-slate-600 dark:to-slate-800 border-slate-800 dark:border-slate-500';
            if (phase === 'RESULT') {
              if (isBallCup) {
                cupTone =
                  'from-emerald-500 to-emerald-700 border-emerald-400';
              } else if (isPicked && !isCorrectGuess) {
                cupTone = 'from-rose-500 to-rose-700 border-rose-400';
              }
            }

            return (
              <button
                key={cupId}
                ref={(el) => {
                  cupElRefs.current[cupId] = el;
                }}
                type="button"
                disabled={!isGuessable}
                onClick={() => handleCupPick(cupId)}
                aria-label={`Select cup ${slotNum}`}
                style={{
                  transition:
                    phase === 'SHUFFLING'
                      ? 'none'
                      : lowDetailMode
                      ? 'none'
                      : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className={`group absolute left-0 bottom-8 ${cupSizeClass} flex flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 ${
                  isGuessable ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <div
                  className={`w-full h-full relative rounded-t-2xl rounded-b-md bg-gradient-to-b ${cupTone} border shadow-md flex flex-col items-center justify-between py-2.5 transition-transform ${
                    isGuessable ? 'group-hover:-translate-y-2' : ''
                  }`}
                >
                  <span className="w-3/4 h-1.5 rounded-full bg-white/20" />
                  <span className="font-mono text-xs sm:text-sm font-bold text-white/90">
                    {slotNum}
                  </span>
                  <span className="w-[108%] h-2.5 rounded-full bg-black/25 border-t border-white/15" />
                </div>
              </button>
            );
          })}
        </div>

        {phase === 'RESULT' && (
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-sm font-medium ${
              isCorrectGuess
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
            }`}
          >
            {isCorrectGuess ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>
              {isCorrectGuess
                ? `Found it! Current streak: ${streak}.`
                : `Game over on round #${roundNum}. Final streak: ${streak}.`}
            </span>
          </div>
        )}
      </div>

      {/* Ball Icon Customizer with Perfect Circle Cut */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <CircleDot className="w-4 h-4 accent-text shrink-0" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Ball Icon &amp; Automatic Perfect-Circle Crop
          </h2>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Upload any <strong>PNG, JPG, JPEG, or GIF</strong> for the ball. Rectangular or non-circular images automatically have everything outside the perfect circle cut away while preserving GIF animation.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 min-w-0">
            {/* Perfect circular cut preview */}
            <div className="w-16 h-16 aspect-square rounded-full overflow-hidden border-2 border-white dark:border-slate-700 shadow-sm bg-slate-200 dark:bg-slate-900 flex items-center justify-center shrink-0">
              {ballAsset ? (
                <img
                  src={ballAsset.dataUrl}
                  alt="Circular cropped ball preview"
                  style={
                    ballAsset.mimeType === 'image/gif'
                      ? { transform: `scale(${circleZoom})` }
                      : undefined
                  }
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <div className="w-full h-full accent-bg relative">
                  <div className="absolute top-2 left-2.5 w-4 h-4 rounded-full bg-white/45 blur-[1px]" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {ballAsset ? ballAsset.fileName : 'Default Lab Sphere'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {ballAsset
                  ? 'Cropped into a 1:1 perfect circle · Saved locally'
                  : 'Accepts PNG, JPG, JPEG, and animated GIF'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {customMediaAllowed ? (
              <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                <ImagePlus className="w-3.5 h-3.5" />
                <span>{ballAsset ? 'Replace Ball Icon' : 'Upload Ball Icon'}</span>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif"
                  onChange={handleBallUpload}
                  className="sr-only"
                />
              </label>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg whitespace-nowrap shrink-0">
                Disabled by Parental Controls
              </span>
            )}

            {ballAsset && (
              <button
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  setConfirmResetModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>
            )}
          </div>
        </div>

        {ballAsset && (
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-400">
                Circle Crop Zoom (tighten circle cut if image has outer margins)
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {circleZoom.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={circleZoom}
              onChange={(e) => void handleZoomChange(parseFloat(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
          </label>
        )}

        {ballError && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{ballError}</p>
        )}
      </section>

      <GameLeaderboardPanel
        boardKey={`shuffle_${difficulty}` as BoardKey}
        localPayload={
          bestRecords[difficulty]
            ? shuffleRecordToPayload(bestRecords[difficulty]!)
            : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />

      <PasswordConfirmModal
        open={confirmResetModal}
        title="Delete Custom Ball Icon"
        description="Enter your account password to delete your saved custom ball icon."
        confirmLabel="Verify & Delete"
        onCancel={() => setConfirmResetModal(false)}
        onConfirmed={resetBallIcon}
      />
    </div>
  );
}
