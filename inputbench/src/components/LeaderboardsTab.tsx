import {
  Crown,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  UserCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  BOARD_META_MAP,
  BoardKey,
  collectAllLocalPayloads,
  GameModuleId,
  getBoardsForGame,
  LEADERBOARD_GAMES,
} from '../data/leaderboards';
import { BenchmarkStore, ModuleId } from '../types/benchmark';
import {
  deleteMyBoardEntry,
  GlobalLeaderboardRow,
  isBetterBoardScore,
  subscribeBoardEntries,
} from '../utils/leaderboardService';
import { SpotlightCard } from './MotionPrimitives';
import { PasswordConfirmModal } from './PasswordConfirmModal';

interface LeaderboardsTabProps {
  store: BenchmarkStore;
  lowDetailMode: boolean;
  initialGameId?: GameModuleId;
  initialBoardKey?: BoardKey;
  onPlayGame: (module: ModuleId) => void;
}

export function LeaderboardsTab({
  store,
  lowDetailMode,
  initialGameId = 'cps',
  initialBoardKey,
  onPlayGame,
}: LeaderboardsTabProps) {
  const {
    user,
    accountProfile,
    authReady,
    displayName,
    syncingAll,
    statusBanner,
    clearStatusBanner,
    signOut,
    submitScore,
    syncLocalStore,
  } = useFirebase();

  const [selectedGame, setSelectedGame] = useState<GameModuleId>(initialGameId);
  const [selectedBoard, setSelectedBoard] = useState<BoardKey>(
    initialBoardKey || getBoardsForGame(initialGameId)[0].boardKey
  );

  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (initialGameId) {
      setSelectedGame(initialGameId);
      if (
        initialBoardKey &&
        BOARD_META_MAP[initialBoardKey]?.gameId === initialGameId
      ) {
        setSelectedBoard(initialBoardKey);
      } else {
        setSelectedBoard(getBoardsForGame(initialGameId)[0].boardKey);
      }
    }
  }, [initialBoardKey, initialGameId]);

  const gameBoards = useMemo(
    () => getBoardsForGame(selectedGame),
    [selectedGame]
  );

  const activeMeta = BOARD_META_MAP[selectedBoard];

  useEffect(() => {
    if (!authReady || !user || !accountProfile?.agreedToPolicy) {
      setRows([]);
      setLoading(false);
      setBoardError(null);
      return;
    }

    setLoading(true);
    setBoardError(null);
    const unsub = subscribeBoardEntries(
      selectedBoard,
      25,
      (nextRows) => {
        setRows(nextRows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setBoardError(
          err.message.includes('Quota exceeded')
            ? 'Daily Firestore free-tier quota exceeded. Quota resets tomorrow.'
            : 'Failed to load live rankings for this board.'
        );
      }
    );

    return () => unsub();
  }, [accountProfile, authReady, selectedBoard, user]);

  const localPayloads = useMemo(() => collectAllLocalPayloads(store), [store]);
  const localForBoard =
    localPayloads.find((p) => p.boardKey === selectedBoard) ?? null;

  const myRowIdx = user ? rows.findIndex((r) => r.uid === user.uid) : -1;
  const myRow = myRowIdx >= 0 ? rows[myRowIdx] : null;
  const canPostLocalForBoard =
    Boolean(user && localForBoard && localForBoard.score > 0) &&
    (!myRow ||
      isBetterBoardScore(selectedBoard, localForBoard!.score, myRow.score));

  const handleDeleteMyEntry = async () => {
    if (!user) return;
    setDeletingEntry(true);
    try {
      await deleteMyBoardEntry(user, selectedBoard);
    } finally {
      setDeletingEntry(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Global Leaderboards
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Live worldwide Top 25 rankings across all seven InputBench games and every difficulty tier.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            sfx.playUiTick();
            onPlayGame(selectedGame);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Play {activeMeta.gameLabel}</span>
        </button>
      </div>

      {/* Player Account & Sync Bar */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center accent-text shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {displayName}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Policy Accepted
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {localPayloads.length} local personal best
                {localPayloads.length === 1 ? '' : 's'} ready to sync globally
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={syncingAll || localPayloads.length === 0}
              onClick={() => {
                sfx.playUiTick();
                void syncLocalStore(store, true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`}
              />
              <span>
                {syncingAll
                  ? 'Syncing...'
                  : `Sync All Local Bests (${localPayloads.length})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                sfx.playUiTick();
                void signOut();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>

        {statusBanner && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={clearStatusBanner}
              className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </SpotlightCard>

      {/* Game Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        {LEADERBOARD_GAMES.map((g) => {
          const active = selectedGame === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                setSelectedGame(g.id);
                setSelectedBoard(getBoardsForGame(g.id)[0].boardKey);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Mode / Difficulty Sub-Board Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {gameBoards.map((board) => {
            const active = selectedBoard === board.boardKey;
            return (
              <button
                key={board.boardKey}
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  setSelectedBoard(board.boardKey);
                }}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'accent-bg border-transparent text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {board.boardLabel}
              </button>
            );
          })}
        </div>

        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Ranked by: {activeMeta.metricHint}
        </span>
      </div>

      {/* Leaderboard Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {activeMeta.gameLabel} · {activeMeta.boardLabel}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {myRowIdx >= 0
                  ? `Your rank: #${myRowIdx + 1} (${myRow?.scoreLabel})`
                  : localForBoard
                  ? `Local best: ${localForBoard.scoreLabel}`
                  : 'No local record on this board yet'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canPostLocalForBoard && localForBoard && (
              <button
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  void submitScore(localForBoard);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Post Local Best ({localForBoard.scoreLabel})</span>
              </button>
            )}

            {myRow && (
              <button
                type="button"
                disabled={deletingEntry}
                onClick={() => {
                  sfx.playUiTick();
                  setShowDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove My Score</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading Top 25 global scores...</span>
          </div>
        ) : boardError ? (
          <div className="p-8 text-sm text-rose-600 dark:text-rose-400 text-center">
            {boardError}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No global entries yet for {activeMeta.gameLabel} ({activeMeta.boardLabel}).
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {localForBoard
                ? `You already have a local record of ${localForBoard.scoreLabel} — post it now to take #1!`
                : 'Play a round in this mode to set the very first global benchmark!'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 w-16">Rank</th>
                  <th className="py-3 px-5">Player</th>
                  <th className="py-3 px-5">Score</th>
                  <th className="py-3 px-5 hidden sm:table-cell">Run Details</th>
                  <th className="py-3 px-5 text-right hidden md:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {rows.map((row, idx) => {
                  const isMe = user ? row.uid === user.uid : false;
                  const rank = idx + 1;
                  return (
                    <tr
                      key={row.uid}
                      className={
                        isMe
                          ? 'bg-blue-50/70 dark:bg-blue-950/35'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="py-3 px-5 font-mono text-xs font-bold tabular-nums">
                        {rank === 1 ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <Crown className="w-4 h-4" />
                            <span>#1</span>
                          </span>
                        ) : rank === 2 ? (
                          <span className="text-slate-600 dark:text-slate-300">#2</span>
                        ) : rank === 3 ? (
                          <span className="text-amber-700 dark:text-amber-500">#3</span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">#{rank}</span>
                        )}
                      </td>
                      <td className="py-3 px-5 font-semibold text-slate-900 dark:text-slate-100">
                        <span>{row.displayName}</span>
                        {isMe && (
                          <span className="ml-2 text-[11px] font-mono font-semibold accent-text">
                            (You)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-5 font-mono font-bold tabular-nums accent-text whitespace-nowrap">
                        {row.scoreLabel}
                      </td>
                      <td className="py-3 px-5 text-xs text-slate-600 dark:text-slate-400 hidden sm:table-cell">
                        {row.detailText}
                      </td>
                      <td className="py-3 px-5 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 hidden md:table-cell whitespace-nowrap">
                        {new Date(row.updatedAtMs).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PasswordConfirmModal
        open={showDeleteModal}
        title="Remove Global Score"
        description={`Enter your account password to delete your global entry from ${activeMeta.gameLabel} (${activeMeta.boardLabel}).`}
        confirmLabel="Verify & Remove Score"
        onCancel={() => setShowDeleteModal(false)}
        onConfirmed={handleDeleteMyEntry}
      />
    </div>
  );
}
