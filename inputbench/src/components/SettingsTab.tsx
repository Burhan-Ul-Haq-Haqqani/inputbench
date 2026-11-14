import {
  Gauge,
  ImagePlus,
  Keyboard,
  LogOut,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { motion } from 'motion/react';
import React, { useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  AccentStyle,
  BackgroundPreset,
  BenchmarkStore,
  RhythmConfig,
  ThemeMode,
  UiPreferences,
} from '../types/benchmark';
import {
  deleteMediaAsset,
  readFileAsDataUrl,
  saveMediaAsset,
  StoredMediaAsset,
} from '../utils/mediaStorage';
import { checkPolicyContent } from '../utils/policyGuard';
import { formatKeyCode } from '../utils/storage';
import { SpotlightCard } from './MotionPrimitives';
import { PasswordConfirmModal } from './PasswordConfirmModal';

interface SettingsTabProps {
  store: BenchmarkStore;
  lowDetailMode: boolean;
  customBgAsset: StoredMediaAsset | null;
  onUpdateCustomBgAsset: (asset: StoredMediaAsset | null) => void;
  onUpdateUiPrefs: (next: UiPreferences) => void;
  onToggleSfx: () => void;
  onUpdateRhythmConfig: (next: RhythmConfig) => void;
  onResetKeybinds: () => void;
  onResetRecords: () => void;
  onOpenParentalControls: () => void;
}

const ACCENT_OPTIONS: {
  id: AccentStyle;
  label: string;
  swatchClass: string;
  ringClass: string;
}[] = [
  {
    id: 'cobalt',
    label: 'Cobalt Blue',
    swatchClass: 'bg-blue-600',
    ringClass: 'ring-blue-500/30',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    swatchClass: 'bg-emerald-600',
    ringClass: 'ring-emerald-500/30',
  },
  {
    id: 'violet',
    label: 'Violet',
    swatchClass: 'bg-violet-600',
    ringClass: 'ring-violet-500/30',
  },
  {
    id: 'rose',
    label: 'Crimson Rose',
    swatchClass: 'bg-rose-600',
    ringClass: 'ring-rose-500/30',
  },
];

const BACKGROUND_PRESETS: {
  id: Exclude<BackgroundPreset, 'custom'>;
  label: string;
  desc: string;
}[] = [
  { id: 'grid', label: 'Lab Dot Grid', desc: 'Precision dot matrix' },
  { id: 'blueprint', label: 'Blueprint Grid', desc: 'Fine technical lines' },
  { id: 'horizon', label: 'Kinetic Horizon', desc: 'Layered diagonal sweeps' },
  { id: 'solid', label: 'Clean Matte', desc: 'Pure solid canvas' },
];

export function SettingsTab({
  store,
  lowDetailMode,
  customBgAsset,
  onUpdateCustomBgAsset,
  onUpdateUiPrefs,
  onToggleSfx,
  onUpdateRhythmConfig,
  onResetKeybinds,
  onResetRecords,
  onOpenParentalControls,
}: SettingsTabProps) {
  const [pendingDeleteAction, setPendingDeleteAction] = useState<
    'records' | 'background' | null
  >(null);
  const [resetDoneMsg, setResetDoneMsg] = useState(false);
  const [bgUploadError, setBgUploadError] = useState<string | null>(null);

  const { displayName, accountProfile, parentalControls, signOut, triggerBan } =
    useFirebase();
  const customMediaAllowed = parentalControls?.allowCustomMedia !== false;
  const { uiPrefs, sfxEnabled, rhythmConfig, cpsConfig } = store;

  const setTheme = (theme: ThemeMode) => {
    sfx.playUiTick();
    onUpdateUiPrefs({ ...uiPrefs, theme });
  };

  const setAccent = (accent: AccentStyle) => {
    sfx.playUiTick();
    onUpdateUiPrefs({ ...uiPrefs, accent });
  };

  const toggleLdm = () => {
    sfx.playUiTick();
    onUpdateUiPrefs({ ...uiPrefs, lowDetailMode: !uiPrefs.lowDetailMode });
  };

  const setBackgroundPreset = (preset: BackgroundPreset) => {
    sfx.playUiTick();
    onUpdateUiPrefs({ ...uiPrefs, backgroundPreset: preset });
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!customMediaAllowed) {
      setBgUploadError('Custom media uploads are locked off by Parental Controls.');
      return;
    }

    setBgUploadError(null);
    const policyCheck = checkPolicyContent(file.name);
    if (!policyCheck.allowed) {
      setBgUploadError('Explicit/offensive images violate Policy Agreements.');
      await triggerBan(
        'Policy violation: attempted to upload explicit image content.',
        'Policy violation ban'
      );
      return;
    }

    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
      setBgUploadError('Please select a PNG, JPG, JPEG, GIF, or WebP image.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const asset: StoredMediaAsset = {
        dataUrl,
        fileName: file.name,
        mimeType: file.type || 'image/png',
        updatedAt: Date.now(),
      };
      await saveMediaAsset('custom_background', asset);
      onUpdateCustomBgAsset(asset);
      onUpdateUiPrefs({ ...uiPrefs, backgroundPreset: 'custom' });
    } catch {
      setBgUploadError('Unable to load that image file.');
    }
  };

  const handleConfirmedDelete = async () => {
    if (pendingDeleteAction === 'background') {
      await deleteMediaAsset('custom_background');
      onUpdateCustomBgAsset(null);
      onUpdateUiPrefs({ ...uiPrefs, backgroundPreset: 'grid' });
    } else if (pendingDeleteAction === 'records') {
      onResetRecords();
      setResetDoneMsg(true);
      window.setTimeout(() => setResetDoneMsg(false), 3000);
    }
    setPendingDeleteAction(null);
  };

  const totalBestCount =
    Object.keys(store.cpsBests).length +
    (store.typingBest ? 1 : 0) +
    Object.keys(store.singleWordBests).length +
    Object.keys(store.spellingBests).length +
    (store.reactionBest ? 1 : 0) +
    Object.keys(store.rhythmBests).length +
    Object.keys(store.waveBests).length +
    Object.keys(store.shuffleBests).length;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Settings & Visual Style
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Customize Light or Dark theme, accent color, Low Detail Mode (LDM), audio feedback, and saved benchmark records.
        </p>
      </div>

      {/* Appearance & Theme */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        delay={0.02}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6"
      >
        <div className="flex items-center gap-2.5">
          <Palette className="w-4 h-4 accent-text shrink-0" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Appearance & Theme
          </h2>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Color Theme
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <motion.button
              type="button"
              whileHover={lowDetailMode ? undefined : { y: -1 }}
              whileTap={lowDetailMode ? undefined : { scale: 0.985 }}
              onClick={() => setTheme('light')}
              className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer ${
                uiPrefs.theme === 'light'
                  ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-amber-500 shrink-0">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Light Mode
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Crisp daylight lab surfaces
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                {uiPrefs.theme === 'light' ? 'Active' : ''}
              </span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={lowDetailMode ? undefined : { y: -1 }}
              whileTap={lowDetailMode ? undefined : { scale: 0.985 }}
              onClick={() => setTheme('dark')}
              className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer ${
                uiPrefs.theme === 'dark'
                  ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-sky-400 shrink-0">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Dark Mode
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Deep slate night workspace
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                {uiPrefs.theme === 'dark' ? 'Active' : ''}
              </span>
            </motion.button>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Accent Color Style
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ACCENT_OPTIONS.map((opt) => {
              const selected = uiPrefs.accent === opt.id;
              return (
                <motion.button
                  key={opt.id}
                  type="button"
                  whileHover={lowDetailMode ? undefined : { y: -1 }}
                  whileTap={lowDetailMode ? undefined : { scale: 0.97 }}
                  onClick={() => setAccent(opt.id)}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    selected
                      ? `bg-slate-50 dark:bg-slate-800 border-slate-400 dark:border-slate-500 ring-2 ${opt.ringClass}`
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full shrink-0 ${opt.swatchClass}`} />
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {opt.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Workspace Background (Site or Local) */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Workspace Background (Site Presets or Local Image / GIF)
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BACKGROUND_PRESETS.map((preset) => {
              const selected = uiPrefs.backgroundPreset === preset.id;
              return (
                <motion.button
                  key={preset.id}
                  type="button"
                  whileHover={lowDetailMode ? undefined : { y: -1 }}
                  whileTap={lowDetailMode ? undefined : { scale: 0.97 }}
                  onClick={() => setBackgroundPreset(preset.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    selected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {preset.label}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {preset.desc}
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                {customBgAsset ? (
                  <img
                    src={customBgAsset.dataUrl}
                    alt={customBgAsset.fileName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImagePlus className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {customBgAsset
                    ? `Local: ${customBgAsset.fileName}`
                    : 'Upload Custom Background'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Supports PNG, JPG, JPEG, GIF, and WebP
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {customBgAsset && uiPrefs.backgroundPreset !== 'custom' && (
                <button
                  type="button"
                  onClick={() => setBackgroundPreset('custom')}
                  className="px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Use Local BG
                </button>
              )}

              {customMediaAllowed ? (
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{customBgAsset ? 'Change Image' : 'Choose from Device'}</span>
                  <input
                    type="file"
                    accept="image/*,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={handleBackgroundUpload}
                    className="sr-only"
                  />
                </label>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg whitespace-nowrap shrink-0">
                  Disabled by Parental Controls
                </span>
              )}

              {customBgAsset && (
                <button
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    setPendingDeleteAction('background');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>

          {bgUploadError && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{bgUploadError}</p>
          )}

          {customBgAsset && uiPrefs.backgroundPreset === 'custom' && (
            <label className="block space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  Background Visibility
                </span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {Math.round(uiPrefs.customBgOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.15}
                max={0.85}
                step={0.05}
                value={uiPrefs.customBgOpacity}
                onChange={(e) =>
                  onUpdateUiPrefs({
                    ...uiPrefs,
                    customBgOpacity: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-blue-600 cursor-pointer"
              />
            </label>
          )}
        </div>
      </SpotlightCard>

      {/* Performance & LDM */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        scrollReveal
        delay={0.04}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center gap-2.5">
          <Gauge className="w-4 h-4 accent-text shrink-0" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Performance & Visual Effects
          </h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Low Detail Mode (LDM)
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Disables ambient mouse glow, click pulses, scroll-reveal animations, backdrop blurs, and 2-Key Rhythm canvas glow/particles for maximum frame rate.
            </p>
          </div>

          <motion.button
            type="button"
            role="switch"
            aria-checked={uiPrefs.lowDetailMode}
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={toggleLdm}
            className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              uiPrefs.lowDetailMode
                ? 'accent-bg border-transparent text-white'
                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {uiPrefs.lowDetailMode ? 'LDM Enabled' : 'LDM Off (High Detail)'}
          </motion.button>
        </div>
      </SpotlightCard>

      {/* Audio & Keybinds */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        scrollReveal
        delay={0.06}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center gap-2.5">
          <Volume2 className="w-4 h-4 accent-text shrink-0" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Audio & Controls
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Global Sound Effects
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Start, completion, death & click SFX
              </div>
            </div>
            <motion.button
              type="button"
              whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
              onClick={onToggleSfx}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sfxEnabled
                  ? 'accent-bg border-transparent text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {sfxEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{sfxEnabled ? 'On' : 'Muted'}</span>
            </motion.button>
          </div>

          <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rhythm Hit Sounds
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Lane audio feedback on note hits
              </div>
            </div>
            <motion.button
              type="button"
              whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
              onClick={() => {
                sfx.playUiTick();
                onUpdateRhythmConfig({ ...rhythmConfig, hitSounds: !rhythmConfig.hitSounds });
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                rhythmConfig.hitSounds
                  ? 'accent-bg border-transparent text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span>{rhythmConfig.hitSounds ? 'On' : 'Off'}</span>
            </motion.button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Keyboard className="w-4 h-4 shrink-0" />
            <span>
              CPS Binds:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {[cpsConfig.primaryKey, cpsConfig.secondaryKey]
                  .filter(Boolean)
                  .map((k) => formatKeyCode(k as string))
                  .join(' / ') || 'Mouse Only'}
              </strong>
              {' · '}Rhythm:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {formatKeyCode(rhythmConfig.leftKey)} / {formatKeyCode(rhythmConfig.rightKey)}
              </strong>
            </span>
          </div>

          <motion.button
            type="button"
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onResetKeybinds();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Keybinds</span>
          </motion.button>
        </div>
      </SpotlightCard>

      {/* Data & Records */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        scrollReveal
        delay={0.08}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Benchmark Records & History
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {totalBestCount} personal bests and {store.recentRuns.length} recent session entries stored locally. Password verification is required to wipe saved data.
          </p>
          {resetDoneMsg && (
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 pt-1">
              All benchmark records and session history cleared.
            </p>
          )}
        </div>

        <motion.button
          type="button"
          whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
          onClick={() => {
            sfx.playUiTick();
            setResetDoneMsg(false);
            setPendingDeleteAction('records');
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer bg-white dark:bg-slate-800 border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Reset Records</span>
        </motion.button>
      </SpotlightCard>

      {/* Account & Policy */}
      <SpotlightCard
        lowDetailMode={lowDetailMode}
        scrollReveal
        delay={0.1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Account: {displayName}
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Policy Agreements accepted ({accountProfile?.policyVersion ?? '2026-11'}) · Password-locked deletions &amp; anti-exploit protection active.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              onOpenParentalControls();
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Parental Controls</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={lowDetailMode ? undefined : { scale: 0.96 }}
            onClick={() => {
              sfx.playUiTick();
              void signOut();
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </motion.button>
        </div>
      </SpotlightCard>

      <PasswordConfirmModal
        open={pendingDeleteAction !== null}
        title={
          pendingDeleteAction === 'background'
            ? 'Remove Custom Background'
            : 'Reset All Benchmark Records'
        }
        description={
          pendingDeleteAction === 'background'
            ? 'Enter your account password to delete your saved local background image.'
            : `Enter your account password to permanently wipe all ${totalBestCount} personal bests and ${store.recentRuns.length} session history entries.`
        }
        confirmLabel={
          pendingDeleteAction === 'background'
            ? 'Verify & Remove'
            : 'Verify & Reset Records'
        }
        onCancel={() => setPendingDeleteAction(null)}
        onConfirmed={handleConfirmedDelete}
      />
    </div>
  );
}
