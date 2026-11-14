import { Pause, Play, RotateCcw, Upload, Volume2, VolumeX } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeAndAnalyzeAudioFile, RhythmAudioPlayer } from '../audio/audioAnalyzer';
import {
  BUILTIN_SYNTH_TRACKS,
  generateRemixChart,
  getRemixPlaybackRate,
  renderSynthTrack,
} from '../audio/synthTracks';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  BoardKey,
  getRhythmBoardKey,
  rhythmRecordToPayload,
} from '../data/leaderboards';
import {
  JudgmentType,
  ModuleId,
  NoteEvent,
  RemixMode,
  RhythmBestRecord,
  RhythmConfig,
  RhythmTrack,
} from '../types/benchmark';
import { checkPolicyContent } from '../utils/policyGuard';
import { formatKeyCode } from '../utils/storage';
import { GameLeaderboardPanel } from './GameLeaderboardPanel';

interface RhythmTestProps {
  config: RhythmConfig;
  bestRecords: Record<string, RhythmBestRecord>;
  darkMode: boolean;
  lowDetailMode: boolean;
  onUpdateConfig: (next: RhythmConfig) => void;
  onComplete: (record: RhythmBestRecord) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type PlayState = 'SETUP' | 'LOADING' | 'PLAYING' | 'PAUSED' | 'RESULTS';

interface RuntimeNote extends NoteEvent {
  judged: boolean;
  holding?: boolean;
  completed?: boolean;
  dropped?: boolean;
  result?: JudgmentType;
}

interface FloatingJudgment {
  label: string;
  subText: string;
  color: string;
  createdAt: number;
}

const JUDGMENT_WEIGHTS: Record<JudgmentType, number> = {
  perfect: 1,
  good: 0.6667,
  ok: 0.3333,
  miss: 0,
};

const JUDGMENT_POINTS: Record<JudgmentType, number> = {
  perfect: 300,
  good: 150,
  ok: 50,
  miss: 0,
};

function computeGrade(accuracy: number): string {
  if (accuracy >= 98) return 'S+';
  if (accuracy >= 94) return 'S';
  if (accuracy >= 88) return 'A';
  if (accuracy >= 78) return 'B';
  return 'C';
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function RhythmTest({
  config,
  bestRecords,
  darkMode,
  lowDetailMode,
  onUpdateConfig,
  onComplete,
  onOpenLeaderboards,
}: RhythmTestProps) {
  const { triggerBan, parentalControls } = useFirebase();
  const customMediaAllowed = parentalControls?.allowCustomMedia !== false;
  const [tracks, setTracks] = useState<RhythmTrack[]>(BUILTIN_SYNTH_TRACKS);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(BUILTIN_SYNTH_TRACKS[0].id);
  const [remix, setRemix] = useState<RemixMode>('nightcore');
  const [playState, setPlayState] = useState<PlayState>('SETUP');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState<boolean>(false);

  // Keybind rebinding state
  const [bindingLane, setBindingLane] = useState<0 | 1 | null>(null);
  const [bindMessage, setBindMessage] = useState<string | null>(null);

  // Live HUD state
  const [score, setScore] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(100);
  const [progressSec, setProgressSec] = useState<number>(0);
  const [totalSec, setTotalSec] = useState<number>(0);
  const [counts, setCounts] = useState<Record<JudgmentType, number>>({
    perfect: 0,
    good: 0,
    ok: 0,
    miss: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<RhythmAudioPlayer | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeBufferRef = useRef<AudioBuffer | null>(null);
  const notesRef = useRef<RuntimeNote[]>([]);
  const lanePressedRef = useRef<[boolean, boolean]>([false, false]);
  const laneFlashRef = useRef<[number, number]>([0, 0]);
  const hitBurstsRef = useRef<{ lane: 0 | 1; color: string; createdAt: number }[]>([]);
  const lastJudgmentRef = useRef<FloatingJudgment | null>(null);

  const statsRef = useRef({
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, ok: 0, miss: 0 } as Record<JudgmentType, number>,
    totalRemixDuration: 0,
    pausedAtSec: 0,
    finished: false,
  });

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? tracks[0],
    [tracks, selectedTrackId]
  );

  const remixRate = getRemixPlaybackRate(remix);
  const effectiveBpm = Math.round(selectedTrack.baseBpm * remixRate);
  const remixDurationSec = selectedTrack.durationSec / remixRate;
  const bestKey = `${selectedTrack.id}__${remix}`;
  const currentBest = bestRecords[bestKey];

  // Clean up audio & animation loop on unmount
  useEffect(() => {
    playerRef.current = new RhythmAudioPlayer();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      playerRef.current?.dispose();
    };
  }, []);

  // Keybind rebinding listener
  useEffect(() => {
    if (bindingLane === null) return;
    const handleRebind = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        setBindingLane(null);
        setBindMessage(null);
        return;
      }

      const otherKey = bindingLane === 0 ? config.rightKey : config.leftKey;
      if (e.code === otherKey) {
        setBindMessage('Left and Right buttons must use different keys.');
        return;
      }

      const nextConfig: RhythmConfig = {
        ...config,
        leftKey: bindingLane === 0 ? e.code : config.leftKey,
        rightKey: bindingLane === 1 ? e.code : config.rightKey,
      };
      onUpdateConfig(nextConfig);
      setBindingLane(null);
      setBindMessage(null);
    };

    window.addEventListener('keydown', handleRebind, true);
    return () => window.removeEventListener('keydown', handleRebind, true);
  }, [bindingLane, config, onUpdateConfig]);

  const syncHudFromStats = useCallback((nowSec: number) => {
    const st = statsRef.current;
    const totalJudged =
      st.counts.perfect + st.counts.good + st.counts.ok + st.counts.miss;
    const weighted =
      st.counts.perfect * JUDGMENT_WEIGHTS.perfect +
      st.counts.good * JUDGMENT_WEIGHTS.good +
      st.counts.ok * JUDGMENT_WEIGHTS.ok;
    const acc = totalJudged > 0 ? Math.round((weighted / totalJudged) * 1000) / 10 : 100;

    setScore(st.score);
    setCombo(st.combo);
    setMaxCombo(st.maxCombo);
    setAccuracy(acc);
    setCounts({ ...st.counts });
    setProgressSec(nowSec);
  }, []);

  const finalizeRun = useCallback(() => {
    if (statsRef.current.finished) return;
    statsRef.current.finished = true;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    playerRef.current?.stop();

    // Mark any remaining unjudged notes as missed
    for (const n of notesRef.current) {
      if (!n.judged) {
        n.judged = true;
        n.result = 'miss';
        statsRef.current.counts.miss++;
      }
    }

    const st = statsRef.current;
    const totalJudged =
      st.counts.perfect + st.counts.good + st.counts.ok + st.counts.miss;
    const weighted =
      st.counts.perfect * JUDGMENT_WEIGHTS.perfect +
      st.counts.good * JUDGMENT_WEIGHTS.good +
      st.counts.ok * JUDGMENT_WEIGHTS.ok;
    const finalAcc = totalJudged > 0 ? Math.round((weighted / totalJudged) * 1000) / 10 : 100;
    const grade = computeGrade(finalAcc);

    syncHudFromStats(st.totalRemixDuration);
    setPlayState('RESULTS');
    sfx.playLevelComplete();

    onComplete({
      trackId: selectedTrack.id,
      trackTitle: selectedTrack.title,
      remix,
      bestScore: st.score,
      bestAccuracy: finalAcc,
      maxCombo: st.maxCombo,
      grade,
      achievedAt: Date.now(),
    });
  }, [onComplete, remix, selectedTrack.id, selectedTrack.title, syncHudFromStats]);

  const registerJudgment = useCallback(
    (type: JudgmentType, deltaMs: number | null) => {
      const st = statsRef.current;
      st.counts[type]++;
      if (type === 'miss') {
        st.combo = 0;
      } else {
        st.combo++;
        if (st.combo > st.maxCombo) st.maxCombo = st.combo;
        const comboBonus = Math.min(2.0, 1 + st.combo * 0.01);
        st.score += Math.round(JUDGMENT_POINTS[type] * comboBonus);
      }

      const labelMap: Record<JudgmentType, string> = {
        perfect: 'PERFECT',
        good: 'GOOD',
        ok: 'OK',
        miss: 'MISS',
      };
      const colorMap: Record<JudgmentType, string> = {
        perfect: '#059669',
        good: '#2563EB',
        ok: '#D97706',
        miss: '#E11D48',
      };
      const subText =
        deltaMs === null
          ? ''
          : `${deltaMs >= 0 ? '+' : ''}${Math.round(deltaMs)} ms`;

      lastJudgmentRef.current = {
        label: labelMap[type],
        subText,
        color: colorMap[type],
        createdAt: performance.now(),
      };
    },
    []
  );

  const handleLaneHit = useCallback(
    (lane: 0 | 1) => {
      if (playState !== 'PLAYING') return;
      laneFlashRef.current[lane] = performance.now();

      if (config.hitSounds) {
        playerRef.current?.playHitSound(lane);
      }

      const player = playerRef.current;
      if (!player) return;
      const songTimeSec = player.getCurrentTimeSec() + config.audioOffsetMs / 1000;

      // Find closest unjudged note in this lane within 150ms
      let candidate: RuntimeNote | null = null;
      let bestAbsDiff = Infinity;
      for (const note of notesRef.current) {
        if (note.judged || note.holding || note.lane !== lane) continue;
        const diff = songTimeSec - note.timeSec;
        const absDiff = Math.abs(diff);
        if (absDiff <= 0.15 && absDiff < bestAbsDiff) {
          bestAbsDiff = absDiff;
          candidate = note;
        }
        if (note.timeSec - songTimeSec > 0.2) break;
      }

      if (!candidate) return;

      const signedMs = (songTimeSec - candidate.timeSec) * 1000;
      const absMs = Math.abs(signedMs);

      let judgment: JudgmentType = 'ok';
      if (absMs <= 45) judgment = 'perfect';
      else if (absMs <= 95) judgment = 'good';

      const judgmentColor =
        judgment === 'perfect'
          ? '#059669'
          : judgment === 'good'
          ? '#2563EB'
          : '#D97706';

      if (!lowDetailMode) {
        hitBurstsRef.current = [
          ...hitBurstsRef.current.slice(-6),
          { lane, color: judgmentColor, createdAt: performance.now() },
        ];
      }

      if (candidate.durationSec && candidate.durationSec > 0) {
        candidate.holding = true;
        candidate.result = judgment;
        registerJudgment(judgment, signedMs);
      } else {
        candidate.judged = true;
        candidate.result = judgment;
        registerJudgment(judgment, signedMs);
      }
    },
    [config.audioOffsetMs, config.hitSounds, lowDetailMode, playState, registerJudgment]
  );

  const handleLaneRelease = useCallback(
    (lane: 0 | 1) => {
      if (playState !== 'PLAYING') return;
      const player = playerRef.current;
      if (!player) return;
      const songTimeSec = player.getCurrentTimeSec() + config.audioOffsetMs / 1000;

      const activeHold = notesRef.current.find(
        (n) => !n.judged && n.holding && n.lane === lane
      );
      if (!activeHold) return;

      const tailTime = activeHold.timeSec + (activeHold.durationSec ?? 0);
      const diffMs = (songTimeSec - tailTime) * 1000;

      if (diffMs >= -150) {
        activeHold.holding = false;
        activeHold.completed = true;
        activeHold.judged = true;
        const tailJudgment: JudgmentType = Math.abs(diffMs) <= 65 ? 'perfect' : 'good';
        activeHold.result = tailJudgment;
        registerJudgment(tailJudgment, diffMs);
        if (config.hitSounds) {
          sfx.playHoldComplete(lane);
        }
      } else {
        activeHold.holding = false;
        activeHold.dropped = true;
        activeHold.judged = true;
        activeHold.result = 'miss';
        registerJudgment('miss', diffMs);
      }
    },
    [config.audioOffsetMs, config.hitSounds, playState, registerJudgment]
  );

  const drawCanvas = useCallback(
    (songTimeSec: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = 420;
      const height = 560;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = darkMode ? '#0F172A' : '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      const laneWidth = 150;
      const highwayLeft = (width - laneWidth * 2) / 2;
      const hitLineY = height - 88;
      const pixelsPerSec = 420 * config.scrollSpeed;
      const nowPerf = performance.now();

      // Lane backgrounds
      for (let lane = 0; lane < 2; lane++) {
        const lx = highwayLeft + lane * laneWidth;
        const isHeld = lanePressedRef.current[lane];
        const flashAge = nowPerf - laneFlashRef.current[lane];
        const flashAlpha =
          !lowDetailMode && flashAge < 120 ? (1 - flashAge / 120) * 0.14 : 0;

        ctx.fillStyle = darkMode
          ? isHeld
            ? '#1E293B'
            : '#0F172A'
          : isHeld
          ? '#EFF6FF'
          : '#F8FAFC';
        ctx.fillRect(lx, 0, laneWidth, height);

        if (flashAlpha > 0) {
          ctx.fillStyle =
            lane === 0
              ? `rgba(37, 99, 235, ${flashAlpha})`
              : `rgba(2, 132, 199, ${flashAlpha})`;
          ctx.fillRect(lx, 0, laneWidth, height);
        }
      }

      // Hairline lane borders
      ctx.strokeStyle = darkMode ? '#1E293B' : '#E2E8F0';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 2; i++) {
        const x = highwayLeft + i * laneWidth + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Subtle scrolling beat grid
      const beatSec = 60 / Math.max(40, effectiveBpm);
      const firstBeat = Math.floor((songTimeSec - 0.5) / beatSec) * beatSec;
      const maxVisibleSec = hitLineY / pixelsPerSec + 0.2;
      ctx.strokeStyle = darkMode ? '#1E293B' : '#E2E8F0';
      ctx.lineWidth = 1;
      for (let bt = firstBeat; bt < songTimeSec + maxVisibleSec; bt += beatSec) {
        const y = hitLineY - (bt - songTimeSec) * pixelsPerSec;
        if (y >= 0 && y <= hitLineY) {
          ctx.beginPath();
          ctx.moveTo(highwayLeft, y);
          ctx.lineTo(highwayLeft + laneWidth * 2, y);
          ctx.stroke();
        }
      }

      // Hit line
      ctx.strokeStyle = darkMode ? '#475569' : '#94A3B8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(highwayLeft, hitLineY);
      ctx.lineTo(highwayLeft + laneWidth * 2, hitLineY);
      ctx.stroke();

      // Receptors at bottom
      const keyLabels = [formatKeyCode(config.leftKey), formatKeyCode(config.rightKey)];
      for (let lane = 0; lane < 2; lane++) {
        const rx = highwayLeft + lane * laneWidth + 14;
        const rw = laneWidth - 28;
        const ry = hitLineY - 14;
        const rh = 28;
        const active = lanePressedRef.current[lane];
        const accent = lane === 0 ? '#2563EB' : '#0284C7';

        ctx.save();
        if (!lowDetailMode && active) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = 14;
        }
        ctx.fillStyle = active ? accent : darkMode ? '#1E293B' : '#FFFFFF';
        ctx.strokeStyle = active ? accent : darkMode ? '#475569' : '#CBD5E1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = active ? '#FFFFFF' : darkMode ? '#CBD5E1' : '#334155';
        ctx.font = '600 13px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(keyLabels[lane], rx + rw / 2, hitLineY + 46);
      }

      // Expanding hit bursts (High Detail Mode only)
      if (!lowDetailMode && hitBurstsRef.current.length > 0) {
        hitBurstsRef.current = hitBurstsRef.current.filter(
          (b) => nowPerf - b.createdAt < 240
        );
        for (const burst of hitBurstsRef.current) {
          const t = (nowPerf - burst.createdAt) / 240;
          const cx = highwayLeft + burst.lane * laneWidth + laneWidth / 2;
          const radius = 18 + t * 34;
          ctx.save();
          ctx.globalAlpha = (1 - t) * 0.7;
          ctx.strokeStyle = burst.color;
          ctx.lineWidth = 2.5 * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(cx, hitLineY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Falling notes (tap notes + hold ribbons)
      for (const note of notesRef.current) {
        const isHold = Boolean(note.durationSec && note.durationSec > 0);
        if (!isHold && note.judged) continue;
        if (isHold && note.completed) continue;

        const nx = highwayLeft + note.lane * laneWidth + 16;
        const nw = laneWidth - 32;
        const nh = 22;
        const noteColor = note.lane === 0 ? '#2563EB' : '#0284C7';

        if (isHold && note.durationSec) {
          const tailTime = note.timeSec + note.durationSec;
          const yHead = note.holding
            ? hitLineY
            : hitLineY - (note.timeSec - songTimeSec) * pixelsPerSec;
          const yTail = hitLineY - (tailTime - songTimeSec) * pixelsPerSec;

          if (yTail > height + 30 || yHead < -30) continue;

          const clampedBottom = Math.min(yHead, height + 20);
          const clampedTop = Math.max(yTail, -20);
          const bodyHeight = Math.max(0, clampedBottom - clampedTop);
          const bodyX = nx + 10;
          const bodyW = nw - 20;

          if (bodyHeight > 0) {
            ctx.fillStyle = note.dropped
              ? 'rgba(148, 163, 184, 0.32)'
              : note.holding
              ? note.lane === 0
                ? 'rgba(37, 99, 235, 0.55)'
                : 'rgba(2, 132, 199, 0.55)'
              : note.lane === 0
              ? 'rgba(37, 99, 235, 0.25)'
              : 'rgba(2, 132, 199, 0.25)';

            ctx.beginPath();
            ctx.roundRect(bodyX, clampedTop, bodyW, bodyHeight, 6);
            ctx.fill();

            ctx.strokeStyle = note.dropped ? '#94A3B8' : noteColor;
            ctx.lineWidth = note.holding ? 2.5 : 1.5;
            ctx.stroke();

            if (!note.dropped) {
              ctx.fillStyle = note.holding ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)';
              ctx.fillRect(
                bodyX + bodyW / 2 - 2,
                clampedTop + 4,
                4,
                Math.max(0, bodyHeight - 8)
              );
            }
          }

          if (yTail >= -20 && yTail <= height + 20) {
            ctx.fillStyle = note.dropped ? '#94A3B8' : noteColor;
            ctx.beginPath();
            ctx.roundRect(nx + 6, yTail - 5, nw - 12, 10, 5);
            ctx.fill();
          }

          if (yHead >= -30 && yHead <= height + 30) {
            ctx.fillStyle = note.dropped ? '#94A3B8' : noteColor;
            ctx.beginPath();
            ctx.roundRect(nx, yHead - nh / 2, nw, nh, 6);
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.fillRect(nx + 10, yHead - nh / 2 + 4, nw - 20, 3);
          }
          continue;
        }

        const dt = note.timeSec - songTimeSec;
        const y = hitLineY - dt * pixelsPerSec;
        if (y < -30 || y > height + 30) continue;

        ctx.fillStyle = noteColor;
        ctx.beginPath();
        ctx.roundRect(nx, y - nh / 2, nw, nh, 6);
        ctx.fill();

        if (!lowDetailMode) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.fillRect(nx + 10, y - nh / 2 + 4, nw - 20, 3);
        }
      }

      // Combo display
      if (statsRef.current.combo > 0) {
        ctx.fillStyle = darkMode ? '#F8FAFC' : '#0F172A';
        ctx.font = '700 34px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(statsRef.current.combo), width / 2, 130);

        ctx.fillStyle = darkMode ? '#94A3B8' : '#64748B';
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('COMBO', width / 2, 156);
      }

      // Floating judgment feedback
      const lastJ = lastJudgmentRef.current;
      if (lastJ && nowPerf - lastJ.createdAt < 450) {
        const alpha = 1 - (nowPerf - lastJ.createdAt) / 450;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = lastJ.color;
        ctx.font = '700 20px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(lastJ.label, width / 2, hitLineY - 76);

        if (lastJ.subText) {
          ctx.fillStyle = darkMode ? '#CBD5E1' : '#475569';
          ctx.font = '500 11px "IBM Plex Mono", monospace';
          ctx.fillText(lastJ.subText, width / 2, hitLineY - 56);
        }
        ctx.restore();
      }

      ctx.restore();
    },
    [config.leftKey, config.rightKey, config.scrollSpeed, darkMode, effectiveBpm, lowDetailMode]
  );

  const runLoop = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const nowSec = player.getCurrentTimeSec();
    const chartTimeSec = nowSec + config.audioOffsetMs / 1000;

    // Check missed notes and auto-complete held notes at their tail
    for (const note of notesRef.current) {
      if (note.judged) continue;

      if (note.holding) {
        const tailTime = note.timeSec + (note.durationSec ?? 0);
        if (chartTimeSec >= tailTime + 0.03) {
          note.holding = false;
          note.completed = true;
          note.judged = true;
          note.result = 'perfect';
          registerJudgment('perfect', 0);
          if (config.hitSounds) {
            sfx.playHoldComplete(note.lane);
          }
        }
        continue;
      }

      if (chartTimeSec - note.timeSec > 0.15) {
        note.judged = true;
        if (note.durationSec) note.dropped = true;
        note.result = 'miss';
        registerJudgment('miss', null);
      } else if (note.timeSec > chartTimeSec + 0.2) {
        break;
      }
    }

    drawCanvas(chartTimeSec);
    syncHudFromStats(nowSec);

    if (nowSec >= statsRef.current.totalRemixDuration - 0.05) {
      finalizeRun();
      return;
    }

    rafRef.current = requestAnimationFrame(runLoop);
  }, [config.audioOffsetMs, drawCanvas, finalizeRun, registerJudgment, syncHudFromStats]);

  const startSong = useCallback(async () => {
    if (bindingLane !== null) return;
    setUploadError(null);
    setPlayState('LOADING');

    try {
      let buffer: AudioBuffer;
      let baseOnsets: number[];

      if (selectedTrack.sourceType === 'synth' && selectedTrack.synthPresetId) {
        const rendered = await renderSynthTrack(selectedTrack.synthPresetId);
        buffer = rendered.buffer;
        baseOnsets = rendered.onsets;
      } else if (selectedTrack.audioBuffer && selectedTrack.baseOnsetsSec) {
        buffer = selectedTrack.audioBuffer;
        baseOnsets = selectedTrack.baseOnsetsSec;
      } else {
        throw new Error('Audio buffer is unavailable.');
      }

      activeBufferRef.current = buffer;
      const chart = generateRemixChart(baseOnsets, remix, buffer.duration);
      notesRef.current = chart.map((n) => ({ ...n, judged: false }));

      const duration = buffer.duration / getRemixPlaybackRate(remix);
      statsRef.current = {
        score: 0,
        combo: 0,
        maxCombo: 0,
        counts: { perfect: 0, good: 0, ok: 0, miss: 0 },
        totalRemixDuration: duration,
        pausedAtSec: 0,
        finished: false,
      };
      lastJudgmentRef.current = null;
      lanePressedRef.current = [false, false];

      setTotalSec(duration);
      syncHudFromStats(0);
      setPlayState('PLAYING');
      sfx.playLevelStart();

      playerRef.current?.start(buffer, remix, 0, () => {
        finalizeRun();
      });

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(runLoop);
    } catch {
      setPlayState('SETUP');
      setUploadError('Unable to initialize audio playback for this track.');
    }
  }, [bindingLane, finalizeRun, remix, runLoop, selectedTrack, syncHudFromStats]);

  const pauseSong = useCallback(() => {
    if (playState !== 'PLAYING' || !playerRef.current) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    statsRef.current.pausedAtSec = playerRef.current.pause();
    setPlayState('PAUSED');
  }, [playState]);

  const resumeSong = useCallback(() => {
    if (playState !== 'PAUSED' || !activeBufferRef.current || !playerRef.current) return;
    setPlayState('PLAYING');
    playerRef.current.start(
      activeBufferRef.current,
      remix,
      statsRef.current.pausedAtSec,
      () => finalizeRun()
    );
    rafRef.current = requestAnimationFrame(runLoop);
  }, [finalizeRun, playState, remix, runLoop]);

  const stopToSetup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    playerRef.current?.stop();
    lanePressedRef.current = [false, false];
    setPlayState('SETUP');
  }, []);

  // Gameplay keyboard handler
  useEffect(() => {
    if (playState !== 'PLAYING' && playState !== 'PAUSED') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      if (e.code === 'Escape') {
        e.preventDefault();
        if (playState === 'PLAYING') pauseSong();
        else if (playState === 'PAUSED') resumeSong();
        return;
      }

      if (playState !== 'PLAYING') return;

      if (e.code === config.leftKey) {
        e.preventDefault();
        lanePressedRef.current[0] = true;
        handleLaneHit(0);
      } else if (e.code === config.rightKey) {
        e.preventDefault();
        lanePressedRef.current[1] = true;
        handleLaneHit(1);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === config.leftKey) {
        lanePressedRef.current[0] = false;
        handleLaneRelease(0);
      } else if (e.code === config.rightKey) {
        lanePressedRef.current[1] = false;
        handleLaneRelease(1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [config.leftKey, config.rightKey, handleLaneHit, handleLaneRelease, pauseSong, playState, resumeSong]);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!customMediaAllowed) {
      setUploadError('Custom audio uploads are disabled by Parental Controls.');
      return;
    }
    setUploadError(null);
    if (!checkPolicyContent(file.name).allowed) {
      setUploadError('Explicit/offensive audio violates Policy Agreements.');
      await triggerBan(
        'Policy violation: attempted to upload explicit music.',
        'Policy violation ban'
      );
      return;
    }

    setIsAnalyzingUpload(true);
    try {
      const analyzed = await decodeAndAnalyzeAudioFile(file);
      setTracks((prev) => [analyzed, ...prev]);
      setSelectedTrackId(analyzed.id);
    } catch {
      setUploadError(
        'Could not decode this audio file. Try a standard MP3, WAV, or OGG track.'
      );
    } finally {
      setIsAnalyzingUpload(false);
    }
  };

  // Draw idle preview canvas when in setup
  useEffect(() => {
    if (playState === 'SETUP') {
      drawCanvas(0);
    }
  }, [drawCanvas, playState, config.leftKey, config.rightKey]);

  const grade = computeGrade(accuracy);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            2-Key Rhythm Mode
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Hit tap and hold falling notes in two lanes using custom keybinds at Normal speed, Nightcore, or Half-Time Lo-Fi.
          </p>
        </div>

        {playState === 'PLAYING' || playState === 'PAUSED' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={playState === 'PLAYING' ? pauseSong : resumeSong}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {playState === 'PLAYING' ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={startSong}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restart</span>
            </button>
            <button
              type="button"
              onClick={stopToSetup}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Exit Track
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Control & Deck Column */}
        <div className="lg:col-span-6 space-y-5">
          {/* Song Selector + Upload */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. Select or Upload Song</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Instant synth tracks or local MP3/WAV beat detection
                </p>
              </div>
              {customMediaAllowed ? (
                <button
                  type="button"
                  disabled={playState === 'PLAYING' || isAnalyzingUpload}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAnalyzingUpload ? 'Analyzing...' : 'Upload Audio'}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg whitespace-nowrap shrink-0">
                  Locked by Parental Controls
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  void handleFileUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>

            {uploadError && (
              <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">
                {uploadError}
              </div>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              {tracks.map((track) => {
                const isSelected = track.id === selectedTrack.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    disabled={playState === 'PLAYING' || playState === 'PAUSED'}
                    onClick={() => {
                      setSelectedTrackId(track.id);
                      if (playState === 'RESULTS') setPlayState('SETUP');
                    }}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors cursor-pointer disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/50'
                        : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-semibold truncate ${
                          isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {track.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {track.subtitle} · {formatDuration(track.durationSec)} base
                      </div>
                    </div>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                      {track.sourceType === 'upload' ? 'Local' : 'Synth'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Speed & Remix Selector */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">2. Choose Speed & Remix</h2>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {effectiveBpm} BPM · {formatDuration(remixDurationSec)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                disabled={playState === 'PLAYING' || playState === 'PAUSED'}
                onClick={() => {
                  setRemix('normal');
                  if (playState === 'RESULTS') setPlayState('SETUP');
                }}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  remix === 'normal'
                    ? 'bg-blue-50/70 dark:bg-blue-950/50 border-blue-500'
                    : 'bg-slate-50/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Normal Speed</div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  1.00x original tempo · Clean audio
                </div>
              </button>

              <button
                type="button"
                disabled={playState === 'PLAYING' || playState === 'PAUSED'}
                onClick={() => {
                  setRemix('nightcore');
                  if (playState === 'RESULTS') setPlayState('SETUP');
                }}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  remix === 'nightcore'
                    ? 'bg-blue-50/70 dark:bg-blue-950/50 border-blue-500'
                    : 'bg-slate-50/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Nightcore</div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  1.30x speed & pitch · Dense chart
                </div>
              </button>

              <button
                type="button"
                disabled={playState === 'PLAYING' || playState === 'PAUSED'}
                onClick={() => {
                  setRemix('lofi');
                  if (playState === 'RESULTS') setPlayState('SETUP');
                }}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  remix === 'lofi'
                    ? 'bg-blue-50/70 dark:bg-blue-950/50 border-blue-500'
                    : 'bg-slate-50/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Half-Time Lo-Fi</div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  0.72x tempo · Warm low-pass
                </div>
              </button>
            </div>
          </div>

          {/* 2-Button Keybinds & Calibration */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                3. Two-Button Keybinds & Calibration
              </h2>
              <button
                type="button"
                onClick={() =>
                  onUpdateConfig({ ...config, hitSounds: !config.hitSounds })
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                {config.hitSounds ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 accent-text" />
                    <span>Hit Sounds On</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                    <span>Hit Sounds Off</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={playState === 'PLAYING'}
                onClick={() => {
                  setBindMessage(null);
                  setBindingLane(bindingLane === 0 ? null : 0);
                }}
                className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  bindingLane === 0
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="text-xs text-slate-500 dark:text-slate-400">Left Lane Key</div>
                <div className="mt-1 text-lg font-mono font-bold text-blue-600 dark:text-blue-400">
                  {bindingLane === 0 ? 'Press any key...' : formatKeyCode(config.leftKey)}
                </div>
              </button>

              <button
                type="button"
                disabled={playState === 'PLAYING'}
                onClick={() => {
                  setBindMessage(null);
                  setBindingLane(bindingLane === 1 ? null : 1);
                }}
                className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  bindingLane === 1
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-500'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="text-xs text-slate-500 dark:text-slate-400">Right Lane Key</div>
                <div className="mt-1 text-lg font-mono font-bold text-sky-600 dark:text-sky-400">
                  {bindingLane === 1 ? 'Press any key...' : formatKeyCode(config.rightKey)}
                </div>
              </button>
            </div>

            {bindMessage && (
              <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                {bindMessage}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <label className="block space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Scroll Speed</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {config.scrollSpeed.toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={2.6}
                  step={0.1}
                  value={config.scrollSpeed}
                  onChange={(e) =>
                    onUpdateConfig({ ...config, scrollSpeed: parseFloat(e.target.value) })
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </label>

              <label className="block space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Audio Offset</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {config.audioOffsetMs >= 0 ? `+${config.audioOffsetMs}` : config.audioOffsetMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={5}
                  value={config.audioOffsetMs}
                  onChange={(e) =>
                    onUpdateConfig({ ...config, audioOffsetMs: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </label>
            </div>

            <div className="pt-2 flex items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Best on {remix === 'normal' ? 'Normal 1.00x' : remix === 'nightcore' ? 'Nightcore' : 'Lo-Fi'}:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {currentBest
                    ? `${currentBest.bestAccuracy.toFixed(1)}% (${currentBest.grade})`
                    : 'No record'}
                </strong>
              </div>
              {playState === 'SETUP' || playState === 'LOADING' ? (
                <button
                  type="button"
                  disabled={playState === 'LOADING'}
                  onClick={() => void startSong()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <Play className="w-4 h-4" />
                  <span>{playState === 'LOADING' ? 'Preparing Audio...' : 'Play Track'}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right Highway Canvas & Live Telemetry Column */}
        <div className="lg:col-span-6 space-y-4">
          {/* Live Telemetry Ribbon */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Score</div>
              <div className="mt-0.5 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {score.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Accuracy</div>
              <div className="mt-0.5 text-lg font-mono font-bold tabular-nums accent-text">
                {accuracy.toFixed(1)}%
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Combo</div>
              <div className="mt-0.5 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {combo}x
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Time</div>
              <div className="mt-0.5 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatDuration(progressSec)}
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                  /{formatDuration(totalSec || remixDurationSec)}
                </span>
              </div>
            </div>
          </div>

          {playState === 'RESULTS' ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
                    Track Complete ·{' '}
                    {remix === 'normal'
                      ? 'Normal 1.00x'
                      : remix === 'nightcore'
                      ? 'Nightcore 1.30x'
                      : 'Half-Time Lo-Fi 0.72x'}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">{selectedTrack.title}</h2>
                </div>
                <div className="w-16 h-16 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-3xl font-mono font-bold accent-text shrink-0">
                  {grade}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 border-y border-slate-100 dark:border-slate-800 py-4">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Final Score</div>
                  <div className="text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {score.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Accuracy</div>
                  <div className="text-xl font-mono font-bold tabular-nums accent-text mt-0.5">
                    {accuracy.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Max Combo</div>
                  <div className="text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {maxCombo}x
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">PERFECT</div>
                  <div className="text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {counts.perfect}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-400">GOOD</div>
                  <div className="text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {counts.good}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">OK</div>
                  <div className="text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {counts.ok}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-rose-700 dark:text-rose-400">MISS</div>
                  <div className="text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {counts.miss}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startSong()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.98] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Play Again</span>
                </button>
                {(['normal', 'nightcore', 'lofi'] as const)
                  .filter((mode) => mode !== remix)
                  .map((otherMode) => (
                    <button
                      key={otherMode}
                      type="button"
                      onClick={() => {
                        setRemix(otherMode);
                        setPlayState('SETUP');
                      }}
                      className="px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                    >
                      Try{' '}
                      {otherMode === 'normal'
                        ? 'Normal 1.00x'
                        : otherMode === 'nightcore'
                        ? 'Nightcore'
                        : 'Half-Time Lo-Fi'}
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center">
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
                <div
                  style={{
                    width: `${
                      totalSec > 0 ? Math.min(100, (progressSec / totalSec) * 100) : 0
                    }%`,
                  }}
                  className="h-full accent-bg transition-all duration-75"
                />
              </div>

              <div className="relative w-full max-w-[420px]">
                <canvas
                  ref={canvasRef}
                  style={{ width: '100%', height: 'auto', aspectRatio: '420 / 560' }}
                  className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                />

                {/* Direct click/touch lane pads for mouse/touch play */}
                <div data-no-global-pulse="true" className="grid grid-cols-2 gap-3 mt-3">
                  <button
                    type="button"
                    onPointerDown={() => {
                      lanePressedRef.current[0] = true;
                      handleLaneHit(0);
                    }}
                    onPointerUp={() => {
                      if (lanePressedRef.current[0]) {
                        lanePressedRef.current[0] = false;
                        handleLaneRelease(0);
                      }
                    }}
                    onPointerLeave={() => {
                      if (lanePressedRef.current[0]) {
                        lanePressedRef.current[0] = false;
                        handleLaneRelease(0);
                      }
                    }}
                    className="py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 active:bg-blue-600 active:text-white active:border-blue-600 text-sm font-mono font-bold text-slate-700 dark:text-slate-200 transition-colors select-none cursor-pointer"
                  >
                    Lane 1 · {formatKeyCode(config.leftKey)}
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => {
                      lanePressedRef.current[1] = true;
                      handleLaneHit(1);
                    }}
                    onPointerUp={() => {
                      if (lanePressedRef.current[1]) {
                        lanePressedRef.current[1] = false;
                        handleLaneRelease(1);
                      }
                    }}
                    onPointerLeave={() => {
                      if (lanePressedRef.current[1]) {
                        lanePressedRef.current[1] = false;
                        handleLaneRelease(1);
                      }
                    }}
                    className="py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 active:bg-sky-600 active:text-white active:border-sky-600 text-sm font-mono font-bold text-slate-700 dark:text-slate-200 transition-colors select-none cursor-pointer"
                  >
                    Lane 2 · {formatKeyCode(config.rightKey)}
                  </button>
                </div>

                {playState === 'PAUSED' && (
                  <div className="absolute inset-0 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center gap-3">
                    <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Track Paused</div>
                    <button
                      type="button"
                      onClick={resumeSong}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Resume</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <GameLeaderboardPanel
        boardKey={getRhythmBoardKey(selectedTrack.id)}
        localPayload={
          currentBest ? rhythmRecordToPayload(currentBest) : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />
    </div>
  );
}
