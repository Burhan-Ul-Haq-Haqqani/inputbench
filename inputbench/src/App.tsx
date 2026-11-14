import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { sfx } from './audio/sfxEngine';
import { AuthGate } from './components/AuthGate';
import { BanScreen } from './components/BanScreen';
import { CpsTest } from './components/CpsTest';
import { FriendsChatTab } from './components/FriendsChatTab';
import { LeaderboardsTab } from './components/LeaderboardsTab';
import { ClickPulseLayer, MouseAuraOverlay } from './components/MotionPrimitives';
import { OverviewHub } from './components/OverviewHub';
import { ReactionTest } from './components/ReactionTest';
import { RhythmTest } from './components/RhythmTest';
import { SecurityShield } from './components/SecurityShield';
import { SettingsTab } from './components/SettingsTab';
import { ShuffleTest } from './components/ShuffleTest';
import { SpellingTest } from './components/SpellingTest';
import { TopBar } from './components/TopBar';
import { TypingTest } from './components/TypingTest';
import { WaveTest } from './components/WaveTest';
import { FirebaseProvider, useFirebase } from './contexts/FirebaseContext';
import {
  BoardKey,
  cpsRecordToPayload,
  GameModuleId,
  reactionRecordToPayload,
  rhythmRecordToPayload,
  shuffleRecordToPayload,
  singleWordToPayload,
  spellingRecordToPayload,
  typingParagraphToPayload,
  waveRecordToPayload,
} from './data/leaderboards';
import {
  BenchmarkStore,
  CpsBestRecord,
  CpsConfig,
  ModuleId,
  ReactionBestRecord,
  RhythmBestRecord,
  RhythmConfig,
  ShuffleBestRecord,
  SingleWordBestRecord,
  SpellingBestRecord,
  TypingBestRecord,
  UiPreferences,
  WaveBestRecord,
} from './types/benchmark';
import { loadMediaAsset, StoredMediaAsset } from './utils/mediaStorage';
import {
  appendRecentRun,
  clearBenchmarkRecords,
  DEFAULT_CPS_CONFIG,
  DEFAULT_RHYTHM_CONFIG,
  loadBenchmarkStore,
  saveBenchmarkStore,
  updateCpsBest,
  updateReactionBest,
  updateRhythmBest,
  updateShuffleBest,
  updateSingleWordBest,
  updateSpellingBest,
  updateTypingBest,
  updateWaveBest,
} from './utils/storage';

function AppShell() {
  const [activeModule, setActiveModule] = useState<ModuleId>('overview');
  const [store, setStore] = useState<BenchmarkStore>(() => loadBenchmarkStore());
  const [customBgAsset, setCustomBgAsset] = useState<StoredMediaAsset | null>(null);
  const [friendsView, setFriendsView] = useState<'chat' | 'parental'>('chat');
  const [lbTarget, setLbTarget] = useState<{
    gameId: GameModuleId;
    boardKey?: BoardKey;
  }>({ gameId: 'cps', boardKey: 'cps_5s' });

  const {
    user,
    accountProfile,
    parentalControls,
    authReady,
    accountLoading,
    submitScore,
    statusBanner,
    clearStatusBanner,
    banState,
  } = useFirebase();

  const customMediaAllowed = parentalControls?.allowCustomMedia !== false;

  useEffect(() => {
    sfx.setEnabled(store.sfxEnabled);
  }, [store.sfxEnabled]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', store.uiPrefs.theme === 'dark');
    root.classList.toggle('ldm', store.uiPrefs.lowDetailMode);
    root.setAttribute('data-accent', store.uiPrefs.accent);
  }, [store.uiPrefs]);

  useEffect(() => {
    sfx.preloadAll();
    void loadMediaAsset('custom_background').then((asset) => {
      if (asset) setCustomBgAsset(asset);
    });
  }, []);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: store.uiPrefs.lowDetailMode ? 'auto' : 'smooth',
    });
  }, [activeModule, store.uiPrefs.lowDetailMode]);

  useEffect(() => {
    if (!statusBanner) return;
    const t = window.setTimeout(() => clearStatusBanner(), 4500);
    return () => window.clearTimeout(t);
  }, [clearStatusBanner, statusBanner]);

  const handleOpenLeaderboardsFromGame = useCallback(
    (gameId: ModuleId, boardKey: BoardKey) => {
      if (
        gameId === 'cps' ||
        gameId === 'typing' ||
        gameId === 'spelling' ||
        gameId === 'reaction' ||
        gameId === 'rhythm' ||
        gameId === 'wave' ||
        gameId === 'shuffle'
      ) {
        setLbTarget({ gameId, boardKey });
      }
      setActiveModule('leaderboards');
    },
    []
  );

  const handleToggleSfx = useCallback(() => {
    setStore((prev) => {
      const nextEnabled = !prev.sfxEnabled;
      const next: BenchmarkStore = { ...prev, sfxEnabled: nextEnabled };
      saveBenchmarkStore(next);
      sfx.setEnabled(nextEnabled);
      if (nextEnabled) sfx.playUiTick();
      return next;
    });
  }, []);

  const handleUpdateUiPrefs = useCallback((nextPrefs: UiPreferences) => {
    setStore((prev) => {
      const next: BenchmarkStore = { ...prev, uiPrefs: nextPrefs };
      saveBenchmarkStore(next);
      return next;
    });
  }, []);

  const handleResetKeybinds = useCallback(() => {
    setStore((prev) => {
      const next: BenchmarkStore = {
        ...prev,
        cpsConfig: DEFAULT_CPS_CONFIG,
        rhythmConfig: {
          ...DEFAULT_RHYTHM_CONFIG,
          hitSounds: prev.rhythmConfig.hitSounds,
        },
      };
      saveBenchmarkStore(next);
      return next;
    });
  }, []);

  const handleResetRecords = useCallback(() => {
    sfx.playUiTick();
    setStore((prev) =>
      clearBenchmarkRecords(
        prev.rhythmConfig,
        prev.cpsConfig,
        prev.sfxEnabled,
        prev.uiPrefs
      )
    );
  }, []);

  const handleCpsUpdateConfig = useCallback((nextConfig: CpsConfig) => {
    setStore((prev) => {
      const next: BenchmarkStore = { ...prev, cpsConfig: nextConfig };
      saveBenchmarkStore(next);
      return next;
    });
  }, []);

  const handleCpsComplete = useCallback(
    (record: CpsBestRecord, consistencyPct: number) => {
      setStore((prev) => {
        const withBest = updateCpsBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'cps',
          headlineMetric: `${record.bestCps.toFixed(2)} CPS`,
          detailText: `${record.durationSec}s window · ${record.totalClicks} clicks · ${consistencyPct}% consistency`,
        });
      });
      void submitScore(cpsRecordToPayload(record));
    },
    [submitScore]
  );

  const handleTypingComplete = useCallback(
    (record: TypingBestRecord, rawWpm: number, errors: number) => {
      setStore((prev) => {
        const withBest = updateTypingBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'typing',
          headlineMetric: `${record.bestWpm} WPM`,
          detailText: `${record.accuracy.toFixed(1)}% accuracy · ${rawWpm} raw WPM · ${errors} errors (${record.modeLabel})`,
        });
      });
      void submitScore(typingParagraphToPayload(record));
    },
    [submitScore]
  );

  const handleSingleWordComplete = useCallback(
    (record: SingleWordBestRecord) => {
      setStore((prev) => {
        const withBest = updateSingleWordBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'typing',
          headlineMetric: `${record.wordsCleared} words · ${record.bestWpm} WPM`,
          detailText: `${record.difficulty.toUpperCase()} survival · ${record.accuracy.toFixed(1)}% accuracy`,
        });
      });
      void submitScore(singleWordToPayload(record));
    },
    [submitScore]
  );

  const handleSpellingComplete = useCallback(
    (record: SpellingBestRecord) => {
      setStore((prev) => {
        const withBest = updateSpellingBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'spelling',
          headlineMetric: `${record.bestWords} words`,
          detailText: `${record.difficulty.toUpperCase()} AI spelling · ${record.accuracy.toFixed(1)}% accuracy · ${record.bestStreak} streak`,
        });
      });
      void submitScore(spellingRecordToPayload(record));
    },
    [submitScore]
  );

  const handleReactionComplete = useCallback(
    (record: ReactionBestRecord, medianMs: number) => {
      setStore((prev) => {
        const withBest = updateReactionBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'reaction',
          headlineMetric: `${Math.round(record.bestAverageMs)} ms`,
          detailText: `${record.rounds} rounds · Fastest ${record.bestSingleMs} ms · Median ${medianMs} ms`,
        });
      });
      void submitScore(reactionRecordToPayload(record));
    },
    [submitScore]
  );

  const handleRhythmUpdateConfig = useCallback((nextConfig: RhythmConfig) => {
    setStore((prev) => {
      const next: BenchmarkStore = { ...prev, rhythmConfig: nextConfig };
      saveBenchmarkStore(next);
      return next;
    });
  }, []);

  const handleRhythmComplete = useCallback(
    (record: RhythmBestRecord) => {
      const remixLabel =
        record.remix === 'normal'
          ? 'Normal 1.00x'
          : record.remix === 'nightcore'
          ? 'Nightcore 1.30x'
          : 'Half-Time Lo-Fi';
      setStore((prev) => {
        const withBest = updateRhythmBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'rhythm',
          headlineMetric: `${record.bestAccuracy.toFixed(1)}% · ${record.grade}`,
          detailText: `${record.trackTitle} (${remixLabel}) · ${record.maxCombo}x max combo`,
        });
      });
      void submitScore(rhythmRecordToPayload(record));
    },
    [submitScore]
  );

  const handleWaveComplete = useCallback(
    (record: WaveBestRecord) => {
      setStore((prev) => {
        const withBest = updateWaveBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'wave',
          headlineMetric: `${record.bestDistance}m · ${record.obstaclesCleared} slopes`,
          detailText: `${record.difficulty.toUpperCase()} wave · ${record.bestTimeSec.toFixed(1)}s survival`,
        });
      });
      void submitScore(waveRecordToPayload(record));
    },
    [submitScore]
  );

  const handleShuffleComplete = useCallback(
    (record: ShuffleBestRecord) => {
      setStore((prev) => {
        const withBest = updateShuffleBest(prev, record);
        return appendRecentRun(withBest, {
          module: 'shuffle',
          headlineMetric: `${record.bestStreak} streak`,
          detailText: `${record.difficulty.toUpperCase()} (${record.cupsCount} cups) · ${record.totalCorrect} correct picks`,
        });
      });
      void submitScore(shuffleRecordToPayload(record));
    },
    [submitScore]
  );

  const { lowDetailMode, theme, backgroundPreset, customBgOpacity } = store.uiPrefs;

  const activePatternClass =
    backgroundPreset === 'blueprint'
      ? 'lab-blueprint-bg opacity-70'
      : backgroundPreset === 'horizon'
      ? 'lab-horizon-bg opacity-90'
      : backgroundPreset === 'grid'
      ? 'lab-grid-bg opacity-65'
      : '';

  if (banState?.banned) {
    return (
      <>
        <SecurityShield />
        <BanScreen banState={banState} />
      </>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <SecurityShield />
      {/* Custom uploaded background (always respected even in LDM if chosen and allowed by Parental Controls) */}
      {backgroundPreset === 'custom' && customBgAsset && customMediaAllowed && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <img
            src={customBgAsset.dataUrl}
            alt=""
            style={{ opacity: customBgOpacity }}
            className="w-full h-full object-cover"
          />
          <div
            className={`absolute inset-0 ${
              theme === 'dark' ? 'bg-slate-950/55' : 'bg-slate-50/55'
            }`}
          />
        </div>
      )}

      {backgroundPreset !== 'custom' && activePatternClass && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 z-0 ${activePatternClass}`}
        />
      )}

      {!lowDetailMode && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 overflow-hidden z-0"
          >
            <div
              style={{
                background:
                  'radial-gradient(60% 45% at 50% 0%, var(--accent-glow), transparent 70%)',
              }}
              className="absolute inset-x-0 top-0 h-[420px]"
            />
          </div>
          <MouseAuraOverlay lowDetailMode={lowDetailMode} />
          <ClickPulseLayer lowDetailMode={lowDetailMode} />
        </>
      )}

      {!authReady || accountLoading ? (
        <div className="relative z-10 flex-1 flex items-center justify-center p-8">
          <div className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin accent-text" />
            <span>Loading InputBench session...</span>
          </div>
        </div>
      ) : !user || !accountProfile?.agreedToPolicy ? (
        <div className="relative z-10 flex-1" data-security-guarded="true">
          <AuthGate />
        </div>
      ) : (
        <>
          <TopBar
            activeModule={activeModule}
            lowDetailMode={lowDetailMode}
            onSelectModule={(mod) => {
              if (mod === 'friends') setFriendsView('chat');
              setActiveModule(mod);
            }}
          />

          {statusBanner && activeModule !== 'leaderboards' && (
            <div className="relative z-20 max-w-6xl w-full mx-auto px-6 pt-3">
              <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                <span>{statusBanner}</span>
                <button
                  type="button"
                  onClick={clearStatusBanner}
                  className="font-semibold hover:underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <main className="relative z-10 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeModule}
            initial={lowDetailMode ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={lowDetailMode ? undefined : { opacity: 0, y: -6 }}
            transition={
              lowDetailMode
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
            }
          >
            {activeModule === 'overview' && (
              <OverviewHub
                store={store}
                sfxEnabled={store.sfxEnabled}
                lowDetailMode={lowDetailMode}
                onToggleSfx={handleToggleSfx}
                onSelectModule={setActiveModule}
              />
            )}
            {activeModule === 'cps' && (
              <CpsTest
                config={store.cpsConfig}
                bestRecords={store.cpsBests}
                onUpdateConfig={handleCpsUpdateConfig}
                onComplete={handleCpsComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'typing' && (
              <TypingTest
                bestRecord={store.typingBest}
                singleWordBests={store.singleWordBests}
                onCompleteParagraph={handleTypingComplete}
                onCompleteSingleWord={handleSingleWordComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'spelling' && (
              <SpellingTest
                bestRecords={store.spellingBests}
                lowDetailMode={lowDetailMode}
                onComplete={handleSpellingComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'reaction' && (
              <ReactionTest
                bestRecord={store.reactionBest}
                onComplete={handleReactionComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'rhythm' && (
              <RhythmTest
                config={store.rhythmConfig}
                bestRecords={store.rhythmBests}
                darkMode={theme === 'dark'}
                lowDetailMode={lowDetailMode}
                onUpdateConfig={handleRhythmUpdateConfig}
                onComplete={handleRhythmComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'wave' && (
              <WaveTest
                bestRecords={store.waveBests}
                darkMode={theme === 'dark'}
                lowDetailMode={lowDetailMode}
                onComplete={handleWaveComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'shuffle' && (
              <ShuffleTest
                bestRecords={store.shuffleBests}
                lowDetailMode={lowDetailMode}
                onComplete={handleShuffleComplete}
                onOpenLeaderboards={handleOpenLeaderboardsFromGame}
              />
            )}
            {activeModule === 'leaderboards' && (
              <LeaderboardsTab
                store={store}
                lowDetailMode={lowDetailMode}
                initialGameId={lbTarget.gameId}
                initialBoardKey={lbTarget.boardKey}
                onPlayGame={setActiveModule}
              />
            )}
            {activeModule === 'friends' && (
              <FriendsChatTab initialView={friendsView} />
            )}
            {activeModule === 'settings' && (
              <SettingsTab
                store={store}
                lowDetailMode={lowDetailMode}
                customBgAsset={customBgAsset}
                onUpdateCustomBgAsset={setCustomBgAsset}
                onUpdateUiPrefs={handleUpdateUiPrefs}
                onToggleSfx={handleToggleSfx}
                onUpdateRhythmConfig={handleRhythmUpdateConfig}
                onResetKeybinds={handleResetKeybinds}
                onResetRecords={handleResetRecords}
                onOpenParentalControls={() => {
                  setFriendsView('parental');
                  setActiveModule('friends');
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <FirebaseProvider>
      <AppShell />
    </FirebaseProvider>
  );
}
