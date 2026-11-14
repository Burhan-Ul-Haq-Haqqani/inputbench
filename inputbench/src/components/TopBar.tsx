import { LogOut, Settings, Trophy, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import { ModuleId } from '../types/benchmark';
import { ScrollProgressHairline } from './MotionPrimitives';

interface TopBarProps {
  activeModule: ModuleId;
  lowDetailMode: boolean;
  onSelectModule: (module: ModuleId) => void;
}

const NAV_ITEMS: {
  id: Exclude<ModuleId, 'settings' | 'leaderboards' | 'friends'>;
  label: string;
}[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cps', label: 'Click Speed' },
  { id: 'typing', label: 'Typing' },
  { id: 'spelling', label: 'Spelling' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'rhythm', label: '2-Key Rhythm' },
  { id: 'wave', label: 'Heartbeat Wave' },
  { id: 'shuffle', label: 'Ball Shuffle' },
];

export function TopBar({
  activeModule,
  lowDetailMode,
  onSelectModule,
}: TopBarProps) {
  const { displayName, signOut } = useFirebase();
  const isSettingsActive = activeModule === 'settings';
  const isLeaderboardsActive = activeModule === 'leaderboards';
  const isFriendsActive = activeModule === 'friends';

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <motion.button
          type="button"
          whileHover={lowDetailMode ? undefined : { scale: 1.015 }}
          whileTap={lowDetailMode ? undefined : { scale: 0.97 }}
          onClick={() => {
            sfx.playUiTick();
            onSelectModule('overview');
          }}
          className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 rounded-sm"
        >
          <img
            src="/app-icon.png"
            alt="InputBench logo"
            className="w-7 h-7 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-700"
          />
          <span>InputBench</span>
        </motion.button>

        <nav
          aria-label="Benchmark modules"
          className="flex items-center gap-5 overflow-x-auto no-scrollbar"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeModule === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
                onClick={() => {
                  sfx.playUiTick();
                  onSelectModule(item.id);
                }}
                className={`relative py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded-sm ${
                  isActive
                    ? 'accent-text'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive &&
                  (lowDetailMode ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-0 bottom-0 h-0.5 accent-bg rounded-full"
                    />
                  ) : (
                    <motion.span
                      layoutId="topbar-active-underline"
                      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                      aria-hidden="true"
                      className="absolute left-0 right-0 bottom-0 h-0.5 accent-bg rounded-full"
                    />
                  ))}
              </motion.button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-2">
          <motion.button
            type="button"
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onSelectModule('leaderboards');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              isLeaderboardsActive
                ? 'accent-bg border-transparent text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80'
            }`}
          >
            <Trophy
              className={`w-3.5 h-3.5 shrink-0 ${
                isLeaderboardsActive ? 'text-white' : 'text-amber-500'
              }`}
            />
            <span className="hidden sm:inline">Leaderboards</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onSelectModule('friends');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
              isFriendsActive
                ? 'bg-emerald-600 border-transparent text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80'
            }`}
          >
            <Users
              className={`w-3.5 h-3.5 shrink-0 ${
                isFriendsActive ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'
              }`}
            />
            <span className="hidden sm:inline">Friends &amp; Safety</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onSelectModule('settings');
            }}
            className={`group inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              isSettingsActive
                ? 'accent-bg border-transparent text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80'
            }`}
          >
            <Settings className="w-3.5 h-3.5 shrink-0 transition-transform duration-300 group-hover:rotate-45" />
            <span>Settings</span>
          </motion.button>

          <motion.button
            type="button"
            title={`Logged in as ${displayName} — Click to log out`}
            aria-label={`Log out (${displayName})`}
            whileHover={lowDetailMode ? undefined : { y: -1 }}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              void signOut();
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-lg border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
          </motion.button>
        </div>
      </div>

      <ScrollProgressHairline lowDetailMode={lowDetailMode} />
    </header>
  );
}
