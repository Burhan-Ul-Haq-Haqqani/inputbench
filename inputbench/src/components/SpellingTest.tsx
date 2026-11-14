import {
  CheckCircle2,
  Heart,
  Loader2,
  RotateCcw,
  Volume2,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { BoardKey, spellingRecordToPayload } from '../data/leaderboards';
import { pickRandomWord, WORD_DIFFICULTY_META } from '../data/wordBanks';
import { ModuleId, SpellingBestRecord, WordDifficulty } from '../types/benchmark';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';

interface SpellingTestProps {
  bestRecords: Partial<Record<WordDifficulty, SpellingBestRecord>>;
  lowDetailMode: boolean;
  onComplete: (record: SpellingBestRecord) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type SpellingPhase = 'READY' | 'PLAYING' | 'REVIEW_MISS' | 'GAME_OVER';
type VoiceOption = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

interface AttemptEntry {
  word: string;
  typed: string;
  correct: boolean;
}

const VOICE_OPTIONS: { id: VoiceOption; label: string }[] = [
  { id: 'Kore', label: 'Kore' },
  { id: 'Puck', label: 'Puck' },
  { id: 'Charon', label: 'Charon' },
  { id: 'Fenrir', label: 'Fenrir' },
  { id: 'Zephyr', label: 'Zephyr' },
];

export function SpellingTest({
  bestRecords,
  lowDetailMode,
  onComplete,
  onOpenLeaderboards,
}: SpellingTestProps) {
  const [difficulty, setDifficulty] = useState<WordDifficulty>('easy');
  const [voice, setVoice] = useState<VoiceOption>('Kore');
  const [phase, setPhase] = useState<SpellingPhase>('READY');
  const [currentWord, setCurrentWord] = useState<string>(() =>
    pickRandomWord('easy', 'spelling', undefined, true)
  );
  const [typedInput, setTypedInput] = useState<string>('');
  const [lives, setLives] = useState<number>(3);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(0);
  const [history, setHistory] = useState<AttemptEntry[]>([]);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'correct' | 'miss';
    word: string;
    typed?: string;
  } | null>(null);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const [voiceSourceLabel, setVoiceSourceLabel] = useState<'AI Voice' | 'Browser Voice'>('AI Voice');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const speakSeqRef = useRef<number>(0);
  const advanceTimerRef = useRef<number | null>(null);

  const stopSpeech = useCallback(() => {
    speakSeqRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setAudioStatus('idle');
  }, []);

  useEffect(() => {
    return () => {
      stopSpeech();
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, [stopSpeech]);

  const speakWithBrowserFallback = useCallback(
    (word: string, seqId: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        if (seqId === speakSeqRef.current) setAudioStatus('idle');
        return;
      }

      setVoiceSourceLabel('Browser Voice');
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`Say ${word}`);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.startsWith('en') && v.localService) ??
        voices.find((v) => v.lang.startsWith('en'));
      if (preferred) utterance.voice = preferred;
      utterance.rate = 0.9;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        if (seqId === speakSeqRef.current) setAudioStatus('speaking');
      };
      utterance.onend = () => {
        if (seqId === speakSeqRef.current) setAudioStatus('idle');
      };
      utterance.onerror = () => {
        if (seqId === speakSeqRef.current) setAudioStatus('idle');
      };

      setAudioStatus('speaking');
      window.speechSynthesis.speak(utterance);
    },
    []
  );

  const speakWordPrompt = useCallback(
    async (word: string, selectedVoice: VoiceOption) => {
      stopSpeech();
      const seqId = speakSeqRef.current;
      const cacheKey = `${selectedVoice}::${word.toLowerCase()}`;
      const cachedUri = audioCacheRef.current.get(cacheKey);

      const playAudioUri = async (dataUri: string) => {
        if (seqId !== speakSeqRef.current) return;
        const audio = new Audio(dataUri);
        activeAudioRef.current = audio;
        setVoiceSourceLabel('AI Voice');
        setAudioStatus('speaking');

        audio.onended = () => {
          if (seqId === speakSeqRef.current) {
            setAudioStatus('idle');
            activeAudioRef.current = null;
          }
        };
        audio.onerror = () => {
          if (seqId === speakSeqRef.current) {
            activeAudioRef.current = null;
            speakWithBrowserFallback(word, seqId);
          }
        };

        try {
          await audio.play();
        } catch {
          if (seqId === speakSeqRef.current) {
            speakWithBrowserFallback(word, seqId);
          }
        }
      };

      if (cachedUri) {
        await playAudioUri(cachedUri);
        return;
      }

      setAudioStatus('loading');
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch('/api/spelling-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, voiceName: selectedVoice }),
          signal: controller.signal,
        });

        if (seqId !== speakSeqRef.current) return;

        if (!res.ok) {
          speakWithBrowserFallback(word, seqId);
          return;
        }

        const data = (await res.json()) as {
          audioBase64?: string;
          mimeType?: string;
        };

        if (seqId !== speakSeqRef.current) return;

        if (data.audioBase64) {
          const mime = data.mimeType || 'audio/wav';
          const uri = `data:${mime};base64,${data.audioBase64}`;
          audioCacheRef.current.set(cacheKey, uri);
          await playAudioUri(uri);
          return;
        }

        speakWithBrowserFallback(word, seqId);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (seqId === speakSeqRef.current) {
          speakWithBrowserFallback(word, seqId);
        }
      }
    },
    [speakWithBrowserFallback, stopSpeech]
  );

  const startSession = useCallback(
    (nextDiff?: WordDifficulty) => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      const activeDiff = nextDiff ?? difficulty;
      if (nextDiff) setDifficulty(nextDiff);

      const firstWord = pickRandomWord(activeDiff, 'spelling');
      setPhase('PLAYING');
      setCurrentWord(firstWord);
      setTypedInput('');
      setLives(3);
      setCorrectCount(0);
      setStreak(0);
      setBestStreak(0);
      setHistory([]);
      setFeedbackBanner(null);

      sfx.playLevelStart();
      void speakWordPrompt(firstWord, voice);
      window.setTimeout(() => inputRef.current?.focus(), 40);
    },
    [difficulty, speakWordPrompt, voice]
  );

  const resetToReady = useCallback(
    (nextDiff?: WordDifficulty) => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      stopSpeech();
      const activeDiff = nextDiff ?? difficulty;
      if (nextDiff) setDifficulty(nextDiff);
      setPhase('READY');
      setCurrentWord(pickRandomWord(activeDiff, 'spelling', undefined, true));
      setTypedInput('');
      setLives(3);
      setCorrectCount(0);
      setStreak(0);
      setBestStreak(0);
      setHistory([]);
      setFeedbackBanner(null);
    },
    [difficulty, stopSpeech]
  );

  const advanceToNextWord = useCallback(() => {
    const nextWord = pickRandomWord(difficulty, 'spelling', currentWord);
    setPhase('PLAYING');
    setCurrentWord(nextWord);
    setTypedInput('');
    setFeedbackBanner(null);
    void speakWordPrompt(nextWord, voice);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [currentWord, difficulty, speakWordPrompt, voice]);

  const handleSubmitAttempt = (e: React.FormEvent) => {
    e.preventDefault();

    if (phase === 'REVIEW_MISS') {
      sfx.playUiTick();
      advanceToNextWord();
      return;
    }

    if (phase !== 'PLAYING') return;
    const cleaned = typedInput.trim();
    if (!cleaned) return;

    const normalizeWord = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isCorrect = normalizeWord(cleaned) === normalizeWord(currentWord);
    const nextEntry: AttemptEntry = {
      word: currentWord,
      typed: cleaned,
      correct: isCorrect,
    };
    const nextHistory = [...history, nextEntry];
    setHistory(nextHistory);

    if (isCorrect) {
      const nextCorrect = correctCount + 1;
      const nextStreak = streak + 1;
      const nextBestStreak = Math.max(bestStreak, nextStreak);

      setCorrectCount(nextCorrect);
      setStreak(nextStreak);
      setBestStreak(nextBestStreak);
      setFeedbackBanner({ type: 'correct', word: currentWord });
      sfx.playWordClear();
      stopSpeech();

      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
      advanceTimerRef.current = window.setTimeout(() => {
        const nextWord = pickRandomWord(difficulty, 'spelling', currentWord);
        setCurrentWord(nextWord);
        setTypedInput('');
        setFeedbackBanner(null);
        void speakWordPrompt(nextWord, voice);
        inputRef.current?.focus();
      }, 650);
    } else {
      const remainingLives = lives - 1;
      setLives(remainingLives);
      setStreak(0);
      stopSpeech();

      if (remainingLives <= 0) {
        sfx.playDeath();
        setPhase('GAME_OVER');
        setFeedbackBanner({
          type: 'miss',
          word: currentWord,
          typed: cleaned,
        });

        const totalAttempts = nextHistory.length;
        const acc =
          totalAttempts > 0
            ? Math.round((correctCount / totalAttempts) * 1000) / 10
            : 0;
        onComplete({
          difficulty,
          bestWords: correctCount,
          bestStreak,
          accuracy: acc,
          achievedAt: Date.now(),
        });
      } else {
        sfx.playStrike();
        setPhase('REVIEW_MISS');
        setFeedbackBanner({
          type: 'miss',
          word: currentWord,
          typed: cleaned,
        });
      }
    }
  };

  const totalAttempts = history.length;
  const accuracyPct =
    totalAttempts > 0
      ? Math.round((correctCount / totalAttempts) * 1000) / 10
      : 100;
  const currentDiffBest = bestRecords[difficulty];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            AI Voice Spelling Test
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Listen as the AI voice says &ldquo;Say &#123;word&#125;&rdquo;, then spell it accurately before losing 3 lives.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          {(['easy', 'medium', 'hard', 'extreme'] as const).map((diff) => (
            <button
              key={diff}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                resetToReady(diff);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                difficulty === diff
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {WORD_DIFFICULTY_META[diff].label}
            </button>
          ))}
        </div>
      </div>

      {/* Voice Selector Row */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Volume2 className="w-4 h-4 accent-text shrink-0" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              AI Announcer Voice
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Speaks &ldquo;Say &#123;random word&#125;&rdquo; using {voiceSourceLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {VOICE_OPTIONS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                setVoice(v.id);
                if (phase === 'PLAYING') {
                  void speakWordPrompt(currentWord, v.id);
                }
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                voice === v.id
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Words Correct</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
            {correctCount}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Current Streak</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {streak}
            <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
              (max {bestStreak})
            </span>
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
            {WORD_DIFFICULTY_META[difficulty].label} Best
          </div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {currentDiffBest ? currentDiffBest.bestWords : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">words</span>
          </div>
        </div>
      </div>

      {/* Main Stage */}
      {phase === 'READY' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 flex flex-col items-center text-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center accent-text">
            <Volume2 className="w-7 h-7" />
          </div>
          <div className="space-y-2 max-w-lg">
            <div className="text-xs font-mono uppercase tracking-wider accent-text font-semibold">
              {WORD_DIFFICULTY_META[difficulty].label} Tier · Sample: {WORD_DIFFICULTY_META[difficulty].sample}
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Ready for AI Spelling Dictation
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Each round picks a random word from {WORD_DIFFICULTY_META[difficulty].label} difficulty.
              The voice says &ldquo;Say &#123;word&#125;&rdquo; — capitalization, punctuation, and grammar are ignored until 3 mistakes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => startSession()}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Volume2 className="w-4 h-4" />
            <span>Start Spelling Test</span>
          </button>
        </div>
      )}

      {(phase === 'PLAYING' || phase === 'REVIEW_MISS') && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
                  audioStatus === 'speaking'
                    ? 'accent-bg border-transparent text-white'
                    : audioStatus === 'loading'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 accent-text'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {audioStatus === 'loading' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : audioStatus === 'speaking' && !lowDetailMode ? (
                  <div className="flex items-end gap-0.5 h-4">
                    <span className="w-1 h-4 bg-white rounded-full animate-eq-1 origin-bottom" />
                    <span className="w-1 h-4 bg-white rounded-full animate-eq-2 origin-bottom" />
                    <span className="w-1 h-4 bg-white rounded-full animate-eq-3 origin-bottom" />
                  </div>
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Word {history.length + (phase === 'REVIEW_MISS' ? 0 : 1)} ·{' '}
                  {WORD_DIFFICULTY_META[difficulty].label} Mode
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {audioStatus === 'loading'
                    ? 'Preparing AI voice prompt...'
                    : audioStatus === 'speaking'
                    ? 'AI Voice: "Say ..."'
                    : 'Type the word you heard'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void speakWordPrompt(currentWord, voice)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Replay Audio</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  resetToReady();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmitAttempt} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                ref={inputRef}
                type="text"
                value={typedInput}
                disabled={phase === 'REVIEW_MISS'}
                onChange={(e) => setTypedInput(e.target.value)}
                placeholder="Type your spelling here..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="flex-1 px-4 py-3.5 text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 disabled:opacity-60"
              />

              {phase === 'PLAYING' ? (
                <button
                  type="submit"
                  className="px-6 py-3.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Check Spelling
                </button>
              ) : (
                <button
                  type="submit"
                  autoFocus
                  className="px-6 py-3.5 text-sm font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Next Word
                </button>
              )}
            </div>
          </form>

          {feedbackBanner && feedbackBanner.type === 'correct' && (
            <div className="flex items-center gap-2.5 text-sm font-medium text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Correct! <strong className="font-mono">{feedbackBanner.word}</strong>
              </span>
            </div>
          )}

          {feedbackBanner && feedbackBanner.type === 'miss' && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2.5">
                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>
                  You typed <strong className="font-mono">&ldquo;{feedbackBanner.typed}&rdquo;</strong>
                  {' · '}Correct spelling:{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">{feedbackBanner.word}</strong>
                </span>
              </div>
              <span className="text-xs font-mono font-semibold text-rose-700 dark:text-rose-300">
                {lives} {lives === 1 ? 'life' : 'lives'} left
              </span>
            </div>
          )}
        </div>
      )}

      {phase === 'GAME_OVER' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-rose-700 dark:text-rose-400 font-semibold">
                3 Fails Reached · {WORD_DIFFICULTY_META[difficulty].label} Spelling Complete
              </div>
              <h2 className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                {correctCount} Words Correct · {accuracyPct.toFixed(1)}% Accuracy
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Best streak {bestStreak} · Total words attempted {totalAttempts}
              </p>
            </div>

            <button
              type="button"
              onClick={() => startSession()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Play Again</span>
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Spelling Round History</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {correctCount}/{history.length} correct
            </span>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">#</th>
                <th className="py-2.5 px-5">Target Word</th>
                <th className="py-2.5 px-5">Your Spelling</th>
                <th className="py-2.5 px-5 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {[...history].reverse().map((item, idx) => (
                <tr key={history.length - idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-5 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {history.length - idx}
                  </td>
                  <td className="py-2.5 px-5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {item.word}
                  </td>
                  <td className="py-2.5 px-5 font-mono text-slate-700 dark:text-slate-300">{item.typed}</td>
                  <td className="py-2.5 px-5 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        item.correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {item.correct ? 'Correct' : 'Missed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GameLeaderboardPanel
        boardKey={`spelling_${difficulty}` as BoardKey}
        localPayload={
          currentDiffBest ? spellingRecordToPayload(currentDiffBest) : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />
    </div>
  );
}
