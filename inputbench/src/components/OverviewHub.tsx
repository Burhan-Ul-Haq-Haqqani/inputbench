import {
  Activity,
  ArrowRight,
  CircleDot,
  Keyboard,
  MousePointerClick,
  Music2,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { sfx } from '../audio/sfxEngine';
import { BenchmarkStore, ModuleId } from '../types/benchmark';
import { ScrollRevealSection, SpotlightCard } from './MotionPrimitives';

interface OverviewHubProps {
  store: BenchmarkStore;
  sfxEnabled: boolean;
  lowDetailMode: boolean;
  onToggleSfx: () => void;
  onSelectModule: (module: ModuleId) => void;
}

export function OverviewHub({
  store,
  sfxEnabled,
  lowDetailMode,
  onToggleSfx,
  onSelectModule,
}: OverviewHubProps) {
  const { scrollY } = useScroll();
  const heroParallaxY = useTransform(scrollY, [0, 260], [0, 14]);
  const heroScrollOpacity = useTransform(scrollY, [0, 260], [1, 0.92]);

  const bestCps5s = store.cpsBests[5]?.bestCps ?? null;
  const bestAnyCps = Object.values(store.cpsBests).reduce<number | null>(
    (max, rec) => (max === null || rec.bestCps > max ? rec.bestCps : max),
    null
  );
  const bestWpm = store.typingBest?.bestWpm ?? null;
  const bestSurvival = Object.values(store.singleWordBests).reduce<{
    wordsCleared: number;
    difficulty: string;
  } | null>((best, rec) => {
    if (!rec) return best;
    if (!best || rec.wordsCleared > best.wordsCleared) {
      return { wordsCleared: rec.wordsCleared, difficulty: rec.difficulty };
    }
    return best;
  }, null);
  const bestSpelling = Object.values(store.spellingBests).reduce<{
    bestWords: number;
    difficulty: string;
  } | null>((best, rec) => {
    if (!rec) return best;
    if (!best || rec.bestWords > best.bestWords) {
      return { bestWords: rec.bestWords, difficulty: rec.difficulty };
    }
    return best;
  }, null);
  const bestReaction = store.reactionBest?.bestAverageMs ?? null;
  const bestRhythm = Object.values(store.rhythmBests).reduce<{
    accuracy: number;
    grade: string;
    title: string;
  } | null>((best, rec) => {
    if (!best || rec.bestAccuracy > best.accuracy) {
      return { accuracy: rec.bestAccuracy, grade: rec.grade, title: rec.trackTitle };
    }
    return best;
  }, null);
  const bestWave = Object.values(store.waveBests).reduce<{
    bestDistance: number;
    difficulty: string;
  } | null>((best, rec) => {
    if (!rec) return best;
    if (!best || rec.bestDistance > best.bestDistance) {
      return { bestDistance: rec.bestDistance, difficulty: rec.difficulty };
    }
    return best;
  }, null);
  const bestShuffle = Object.values(store.shuffleBests).reduce<{
    bestStreak: number;
    difficulty: string;
  } | null>((best, rec) => {
    if (!rec) return best;
    if (!best || rec.bestStreak > best.bestStreak) {
      return { bestStreak: rec.bestStreak, difficulty: rec.difficulty };
    }
    return best;
  }, null);

  const modules: {
    id: Exclude<ModuleId, 'overview' | 'leaderboards' | 'settings' | 'friends'>;
    title: string;
    meta: string;
    description: string;
    metricLabel: string;
    metricValue: string;
    icon: typeof MousePointerClick;
  }[] = [
    {
      id: 'cps',
      title: 'Clicks Per Second',
      meta: '1s / 5s / 10s / 30s · Pointer & Custom Keys',
      description:
        'Measure raw click frequency and click-rate consistency across timed intervals with sub-millisecond capture.',
      metricLabel: bestCps5s !== null ? '5s Personal Best' : 'Peak CPS Best',
      metricValue:
        bestCps5s !== null
          ? `${bestCps5s.toFixed(2)} CPS`
          : bestAnyCps !== null
          ? `${bestAnyCps.toFixed(2)} CPS`
          : 'No record',
      icon: MousePointerClick,
    },
    {
      id: 'typing',
      title: 'Typing Speed & Accuracy',
      meta: 'Paragraph · Single-Word Survival (3 Lives)',
      description:
        'Benchmark full-paragraph speed and accuracy, or test infinite Single-Word Survival from Easy ("yes") to Extreme ("Conceptualization") until 3 fails.',
      metricLabel: bestWpm !== null ? 'Paragraph Best' : 'Survival Best',
      metricValue:
        bestWpm !== null
          ? `${bestWpm} WPM · ${store.typingBest?.accuracy.toFixed(1)}%`
          : bestSurvival !== null
          ? `${bestSurvival.wordsCleared} words (${bestSurvival.difficulty})`
          : 'No record',
      icon: Keyboard,
    },
    {
      id: 'spelling',
      title: 'AI Voice Spelling',
      meta: 'Gemini AI Voice · Easy to Extreme (3 Lives)',
      description:
        'Listen as an AI voice says "Say {word}" from your chosen difficulty tier and spell each word accurately until 3 mistakes.',
      metricLabel: 'Spelling Best',
      metricValue: bestSpelling
        ? `${bestSpelling.bestWords} words (${bestSpelling.difficulty})`
        : 'No record',
      icon: Volume2,
    },
    {
      id: 'reaction',
      title: 'Reaction Time',
      meta: '3 / 5 / 10 Trials · False-Start Guard',
      description:
        'Benchmark visual-motor response latency in milliseconds with randomized cue delays and trial variance.',
      metricLabel: 'Best Session Avg',
      metricValue:
        bestReaction !== null
          ? `${Math.round(bestReaction)} ms`
          : 'No record',
      icon: Zap,
    },
    {
      id: 'rhythm',
      title: '2-Key Rhythm Mode',
      meta: 'Hold Notes · Custom Keys · Nightcore & Lo-Fi',
      description:
        'Two-lane falling-note rhythm test with tap and hold notes, supporting built-in synth tracks or any uploaded MP3/WAV.',
      metricLabel: 'Top Chart Accuracy',
      metricValue: bestRhythm
        ? `${bestRhythm.accuracy.toFixed(1)}% · Grade ${bestRhythm.grade}`
        : 'No record',
      icon: Music2,
    },
    {
      id: 'wave',
      title: 'Heartbeat Wave',
      meta: '45° Flight · Randomized 45° Slopes · Custom Skin & Music',
      description:
        'Pilot a 45° wave dart past randomized 45° slopes from Easy to Hard with site or local music and PNG/JPG/GIF wave decorations.',
      metricLabel: 'Furthest Wave Run',
      metricValue: bestWave
        ? `${bestWave.bestDistance}m (${bestWave.difficulty})`
        : 'No record',
      icon: Activity,
    },
    {
      id: 'shuffle',
      title: 'Ball Shuffle',
      meta: '2 / 5 / 10 Cups · Custom Circle-Cut PNG / GIF Ball',
      description:
        'Track the ball under rapid cup swaps from Easy (2 cups) to Hard (10 cups), with custom PNG, JPG, JPEG, or GIF ball icons automatically cut into a perfect circle.',
      metricLabel: 'Best Streak',
      metricValue: bestShuffle
        ? `${bestShuffle.bestStreak} streak (${bestShuffle.difficulty})`
        : 'No record',
      icon: CircleDot,
    },
  ];

  const kpiCards: {
    moduleId: Exclude<ModuleId, 'overview' | 'leaderboards' | 'settings' | 'friends'>;
    label: string;
    value: string;
    unit: string;
    accentUnit?: boolean;
  }[] = [
    {
      moduleId: 'cps',
      label: 'Click Speed Best',
      value: bestAnyCps !== null ? bestAnyCps.toFixed(2) : '—',
      unit: 'CPS',
    },
    {
      moduleId: 'typing',
      label: 'Typing Speed Best',
      value: bestWpm !== null ? String(bestWpm) : '—',
      unit: 'WPM',
    },
    {
      moduleId: 'spelling',
      label: 'AI Spelling Best',
      value: bestSpelling !== null ? String(bestSpelling.bestWords) : '—',
      unit: 'words',
    },
    {
      moduleId: 'reaction',
      label: 'Reaction Avg Best',
      value: bestReaction !== null ? String(Math.round(bestReaction)) : '—',
      unit: 'ms',
    },
    {
      moduleId: 'rhythm',
      label: '2-Key Rhythm Best',
      value: bestRhythm !== null ? `${bestRhythm.accuracy.toFixed(1)}%` : '—',
      unit: bestRhythm ? bestRhythm.grade : '',
      accentUnit: true,
    },
    {
      moduleId: 'wave',
      label: 'Wave Distance Best',
      value: bestWave !== null ? String(bestWave.bestDistance) : '—',
      unit: 'm',
    },
    {
      moduleId: 'shuffle',
      label: 'Ball Shuffle Best',
      value: bestShuffle !== null ? String(bestShuffle.bestStreak) : '—',
      unit: 'streak',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <motion.section
        style={lowDetailMode ? undefined : { y: heroParallaxY, opacity: heroScrollOpacity }}
        initial={lowDetailMode ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          lowDetailMode
            ? { duration: 0 }
            : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
        }
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div className="space-y-3 max-w-2xl">
          <p className="text-xs font-mono font-medium tracking-wider uppercase accent-text">
            Precision Input Diagnostics
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
            Measure speed, accuracy, and timing across seven core tests.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed">
            All measurements run locally in your browser using high-resolution performance timers and Web Audio synchronization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <motion.button
            type="button"
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onSelectModule('leaderboards');
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trophy className="w-4 h-4 text-amber-500" />
            <span>Global Leaderboards</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={onToggleSfx}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sfxEnabled
                ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800'
                : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {sfxEnabled ? (
              <Volume2 className="w-4 h-4 accent-text" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400" />
            )}
            <span>{sfxEnabled ? 'SFX On' : 'SFX Muted'}</span>
          </motion.button>
        </div>
      </motion.section>

      <section
        aria-label="Personal best summary"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3.5"
      >
        {kpiCards.map((card, idx) => (
          <SpotlightCard
            key={card.label}
            lowDetailMode={lowDetailMode}
            delay={idx * 0.035}
            interactive
            onClick={() => {
              sfx.playUiTick();
              onSelectModule(card.moduleId);
            }}
            ariaLabel={`Open ${card.label}`}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl p-4 transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {card.label}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 shrink-0" />
            </div>
            <div className="mt-2 text-xl xl:text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {card.value}
              {card.unit && (
                <span
                  className={`ml-1.5 text-xs uppercase ${
                    card.accentUnit
                      ? 'font-semibold accent-text'
                      : 'font-normal text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {card.unit}
                </span>
              )}
            </div>
          </SpotlightCard>
        ))}
      </section>

      <section aria-label="Benchmark modules" className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {modules.map((mod, idx) => {
          const Icon = mod.icon;
          return (
            <SpotlightCard
              key={mod.id}
              lowDetailMode={lowDetailMode}
              delay={idx * 0.045}
              scrollReveal
              interactive
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between gap-6 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {mod.title}
                    </h2>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{mod.meta}</div>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0 transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3">
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {mod.description}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {mod.metricLabel}
                  </div>
                  <div className="text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {mod.metricValue}
                  </div>
                </div>
                <motion.button
                  type="button"
                  whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
                  onClick={() => {
                    sfx.playUiTick();
                    onSelectModule(mod.id);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white accent-bg rounded-lg transition-transform whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  <span>Start Test</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </motion.button>
              </div>
            </SpotlightCard>
          );
        })}
      </section>

      {store.recentRuns.length > 0 && (
        <ScrollRevealSection
          ariaLabel="Recent benchmark runs"
          lowDetailMode={lowDetailMode}
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Session Log
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Last {store.recentRuns.length} completed runs
            </span>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Test</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Details</th>
                  <th className="py-3 px-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {store.recentRuns.map((run, idx) => {
                  const labelMap: Record<
                    Exclude<ModuleId, 'overview' | 'leaderboards' | 'settings' | 'friends'>,
                    string
                  > = {
                    cps: 'Click Speed',
                    typing: 'Typing',
                    spelling: 'AI Spelling',
                    reaction: 'Reaction',
                    rhythm: '2-Key Rhythm',
                    wave: 'Heartbeat Wave',
                    shuffle: 'Ball Shuffle',
                  };
                  return (
                    <motion.tr
                      key={run.id}
                      initial={lowDetailMode ? false : { opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={
                        lowDetailMode
                          ? { duration: 0 }
                          : { duration: 0.2, delay: Math.min(idx * 0.03, 0.24), ease: [0.16, 1, 0.3, 1] }
                      }
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {labelMap[run.module]}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold tabular-nums accent-text whitespace-nowrap">
                        {run.headlineMetric}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 hidden sm:table-cell">
                        {run.detailText}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {new Date(run.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ScrollRevealSection>
      )}
    </div>
  );
}
