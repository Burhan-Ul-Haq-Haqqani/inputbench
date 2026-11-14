import {
  ArrowUpRight,
  Crown,
  Loader2,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  BOARD_META_MAP,
  BoardKey,
  LeaderboardSubmissionPayload,
} from '../data/leaderboards';
import { ModuleId } from '../types/benchmark';
import {
  GlobalLeaderboardRow,
  isBetterBoardScore,
  subscribeBoardEntries,
} from '../utils/leaderboardService';

interface GameLeaderboardPanelProps {
  boardKey: BoardKey;
  localPayload?: LeaderboardSubmissionPayload | null;
  onOpenFullLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

export function GameLeaderboardPanel({
  boardKey,
  localPayload,
  onOpenFullLeaderboards,
}: GameLeaderboardPanelProps) {
  const { user, authReady, accountProfile, submitScore } = useFirebase();

  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [postingLocal, setPostingLocal] = useState(false);

  const meta = BOARD_META_MAP[boardKey];

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
      boardKey,
      10,
      (nextRows) => {
        setRows(nextRows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setBoardError(
          err.message.includes('Quota exceeded')
            ? 'Daily Firestore free-tier quota exceeded. Try again tomorrow.'
            : 'Unable to load this leaderboard right now.'
        );
      }
    );

    return () => unsub();
  }, [accountProfile, authReady, boardKey, user]);

  const myRowIdx = user ? rows.findIndex((r) => r.uid === user.uid) : -1;
  const myRow = myRowIdx >= 0 ? rows[myRowIdx] : null;

  const canSyncLocalBest =
    Boolean(user && accountProfile?.agreedToPolicy && localPayload && localPayload.score > 0) &&
    (!myRow ||
      isBetterBoardScore(boardKey, localPayload!.score, myRow.score));

  const handlePostLocal = async () => {
    if (!localPayload || !user) return;
    sfx.playUiTick();
    setPostingLocal(true);
    try {
      await submitScore(localPayload);
    } finally {
      setPostingLocal(false);
    }
  };

  return (
    <section
      aria-label={`${meta.gameLabel} global leaderboard`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <Trophy className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Global Top 10 · {meta.boardLabel}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {meta.metricHint}
              {myRowIdx >= 0 ? ` · Your Rank: #${myRowIdx + 1}` : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSyncLocalBest && (
            <button
              type="button"
              disabled={postingLocal}
              onClick={() => void handlePostLocal()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${postingLocal ? 'animate-spin' : ''}`}
              />
              <span>Post Local Best ({localPayload?.scoreLabel})</span>
            </button>
          )}

          {onOpenFullLeaderboards && (
            <button
              type="button"
              onClick={() => {
                sfx.playUiTick();
                onOpenFullLeaderboards(meta.gameId, boardKey);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>All Boards</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading live global rankings...</span>
        </div>
      ) : boardError ? (
        <div className="p-5 text-xs text-rose-600 dark:text-rose-400">
          {boardError}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            No global scores recorded for <strong>{meta.boardLabel}</strong> yet. Complete a run to claim #1!
          </div>
          {localPayload && localPayload.score > 0 && (
            <button
              type="button"
              disabled={postingLocal}
              onClick={() => void handlePostLocal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer whitespace-nowrap"
            >
              <span>Claim #1 ({localPayload.scoreLabel})</span>
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 w-14">Rank</th>
                <th className="py-2.5 px-4">Player</th>
                <th className="py-2.5 px-4">Score</th>
                <th className="py-2.5 px-4 hidden sm:table-cell">Breakdown</th>
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
                        ? 'bg-blue-50/60 dark:bg-blue-950/30'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-2.5 px-4 font-mono text-xs font-bold tabular-nums">
                      {rank === 1 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Crown className="w-3.5 h-3.5" />
                          <span>#1</span>
                        </span>
                      ) : rank === 2 ? (
                        <span className="text-slate-500 dark:text-slate-300">#2</span>
                      ) : rank === 3 ? (
                        <span className="text-amber-700 dark:text-amber-500">#3</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">#{rank}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                      <span>{row.displayName}</span>
                      {isMe && (
                        <span className="ml-2 text-[11px] font-mono font-semibold accent-text">
                          (You)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold tabular-nums accent-text whitespace-nowrap">
                      {row.scoreLabel}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                      {row.detailText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
