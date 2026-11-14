import {
  ImagePlus,
  Music2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeAndAnalyzeAudioFile, RhythmAudioPlayer } from '../audio/audioAnalyzer';
import { sfx } from '../audio/sfxEngine';
import { BUILTIN_SYNTH_TRACKS, renderSynthTrack } from '../audio/synthTracks';
import { useFirebase } from '../contexts/FirebaseContext';
import { BoardKey, waveRecordToPayload } from '../data/leaderboards';
import {
  ModuleId,
  RhythmTrack,
  WaveBestRecord,
  WaveDifficulty,
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

interface WaveTestProps {
  bestRecords: Partial<Record<WaveDifficulty, WaveBestRecord>>;
  darkMode: boolean;
  lowDetailMode: boolean;
  onComplete: (record: WaveBestRecord) => void;
  onOpenLeaderboards?: (gameId: ModuleId, boardKey: BoardKey) => void;
}

type WaveState = 'READY' | 'LOADING_AUDIO' | 'PLAYING' | 'CRASHED';
type DecorationMode = 'skin' | 'badge';

interface Point2D {
  x: number;
  y: number;
}

interface SlopePolygon {
  points: Point2D[];
  kind: 'slope' | 'diamond' | 'pillar';
}

interface ObstacleGroup {
  id: number;
  minX: number;
  maxX: number;
  passed: boolean;
  polygons: SlopePolygon[];
}

const LOGICAL_W = 960;
const LOGICAL_H = 440;
const TOP_RAIL = 28;
const BOTTOM_RAIL = LOGICAL_H - 28;
const PLAYER_SCREEN_X = 190;
const WAVE_HITBOX_R = 7;

const DIFFICULTY_SETTINGS: Record<
  WaveDifficulty,
  {
    label: string;
    speedPxPerSec: number;
    minGap: number;
    maxGap: number;
    spacingMin: number;
    spacingMax: number;
    subtitle: string;
  }
> = {
  easy: {
    label: 'Easy',
    speedPxPerSec: 300,
    minGap: 146,
    maxGap: 186,
    spacingMin: 180,
    spacingMax: 250,
    subtitle: 'Wide corridors · 300 px/s',
  },
  medium: {
    label: 'Medium',
    speedPxPerSec: 395,
    minGap: 108,
    maxGap: 144,
    spacingMin: 140,
    spacingMax: 205,
    subtitle: 'Angled slope tunnels · 395 px/s',
  },
  hard: {
    label: 'Hard',
    speedPxPerSec: 495,
    minGap: 82,
    maxGap: 112,
    spacingMin: 108,
    spacingMax: 165,
    subtitle: 'Tight GD corridors · 495 px/s',
  },
};

function pointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distSqPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) {
    return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

function circleIntersectsPolygon(
  cx: number,
  cy: number,
  r: number,
  poly: Point2D[]
): boolean {
  if (pointInPolygon(cx, cy, poly)) return true;
  const rSq = r * r;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distSqPointToSegment(cx, cy, a.x, a.y, b.x, b.y) <= rSq) {
      return true;
    }
  }
  return false;
}

export function WaveTest({
  bestRecords,
  darkMode,
  lowDetailMode,
  onComplete,
  onOpenLeaderboards,
}: WaveTestProps) {
  const { triggerBan, parentalControls } = useFirebase();
  const customMediaAllowed = parentalControls?.allowCustomMedia !== false;
  const [difficulty, setDifficulty] = useState<WaveDifficulty>('medium');
  const [waveState, setWaveState] = useState<WaveState>('READY');
  const [tracks, setTracks] = useState<RhythmTrack[]>(BUILTIN_SYNTH_TRACKS);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(
    BUILTIN_SYNTH_TRACKS[0].id
  );
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const [uploadAudioError, setUploadAudioError] = useState<string | null>(null);

  const [decoration, setDecoration] = useState<StoredMediaAsset | null>(null);
  const [decorationMode, setDecorationMode] = useState<DecorationMode>('skin');
  const [tiltDecoration, setTiltDecoration] = useState<boolean>(true);
  const [decorationError, setDecorationError] = useState<string | null>(null);
  const [confirmClearModal, setConfirmClearModal] = useState<boolean>(false);

  const [distanceMeters, setDistanceMeters] = useState<number>(0);
  const [obstaclesCleared, setObstaclesCleared] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [spritePos, setSpritePos] = useState<{ yPct: number; angleDeg: number }>({
    yPct: 50,
    angleDeg: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioPlayerRef = useRef<RhythmAudioPlayer | null>(null);
  const rafRef = useRef<number | null>(null);

  const simRef = useRef({
    worldX: 0,
    y: LOGICAL_H / 2,
    isHolding: false,
    lastFrameMs: 0,
    startMs: 0,
    obstaclesCleared: 0,
    nextGenX: 540,
    safeCenterY: LOGICAL_H / 2,
    groupIdCounter: 1,
    obstacles: [] as ObstacleGroup[],
    trail: [] as Point2D[],
    crashParticles: [] as { x: number; y: number; vx: number; vy: number; life: number }[],
    accentHex: '#2563eb',
  });

  const waveStateRef = useRef<WaveState>('READY');
  const difficultyRef = useRef<WaveDifficulty>('medium');

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    if (computed) {
      simRef.current.accentHex = computed;
    }
  }, [darkMode, waveState]);

  useEffect(() => {
    audioPlayerRef.current = new RhythmAudioPlayer();
    void loadMediaAsset('wave_decoration').then((asset) => {
      if (asset) setDecoration(asset);
    });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioPlayerRef.current?.dispose();
    };
  }, []);

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? tracks[0],
    [selectedTrackId, tracks]
  );

  const generateNextObstacleChunk = useCallback((diff: WaveDifficulty) => {
    const sim = simRef.current;
    const cfg = DIFFICULTY_SETTINGS[diff];
    const startX = sim.nextGenX;
    const gap = cfg.minGap + Math.random() * (cfg.maxGap - cfg.minGap);
    const halfGap = gap / 2;

    const minSafe = TOP_RAIL + halfGap + 18;
    const maxSafe = BOTTOM_RAIL - halfGap - 18;
    const prevY = Math.max(minSafe, Math.min(maxSafe, sim.safeCenterY));

    const roll = Math.random();
    const polygons: SlopePolygon[] = [];
    let endX = startX;

    if (roll < 0.46) {
      // Exact 45-degree diagonal corridor (|dy / dx| === 1.000) with short flat lead-in/out tabs
      const diagHalfGap = halfGap * 1.24;
      const diagMin = TOP_RAIL + diagHalfGap + 14;
      const diagMax = BOTTOM_RAIL - diagHalfGap - 14;
      const entryY = Math.max(diagMin, Math.min(diagMax, prevY));

      const roomUp = entryY - diagMin;
      const roomDown = diagMax - entryY;
      const goUp = roomUp > roomDown ? Math.random() < 0.78 : Math.random() < 0.22;
      const maxSpan = goUp ? roomUp : roomDown;
      const span = Math.max(48, Math.min(maxSpan, 68 + Math.random() * 76));
      const exitY = entryY + (goUp ? -span : span);

      const flatLead = 26;
      const diagStart = startX + flatLead;
      const diagEnd = diagStart + span;
      endX = diagEnd + flatLead;

      // Upper 45° wall (no clamping after calculation so angle stays strictly 45°)
      polygons.push({
        kind: 'slope',
        points: [
          { x: startX, y: TOP_RAIL },
          { x: endX, y: TOP_RAIL },
          { x: endX, y: exitY - diagHalfGap },
          { x: diagEnd, y: exitY - diagHalfGap },
          { x: diagStart, y: entryY - diagHalfGap },
          { x: startX, y: entryY - diagHalfGap },
        ],
      });

      // Lower 45° wall (parallel 45° slope)
      polygons.push({
        kind: 'slope',
        points: [
          { x: startX, y: entryY + diagHalfGap },
          { x: diagStart, y: entryY + diagHalfGap },
          { x: diagEnd, y: exitY + diagHalfGap },
          { x: endX, y: exitY + diagHalfGap },
          { x: endX, y: BOTTOM_RAIL },
          { x: startX, y: BOTTOM_RAIL },
        ],
      });

      sim.safeCenterY = exitY;
    } else if (roll < 0.76) {
      // Exact 45-degree triangular wedge slopes from floor or ceiling (rise === run)
      const fromTop = Math.random() < 0.5;
      const maxPossibleH = Math.floor(BOTTOM_RAIL - TOP_RAIL - cfg.minGap - 28);
      const baseMinH = diff === 'hard' ? 112 : diff === 'medium' ? 88 : 64;
      const baseMaxH = diff === 'hard' ? 162 : diff === 'medium' ? 134 : 102;
      const wedgeH = Math.min(
        maxPossibleH,
        Math.round(baseMinH + Math.random() * (baseMaxH - baseMinH))
      );

      endX = startX + wedgeH * 2;
      const midX = startX + wedgeH;

      if (fromTop) {
        const tipY = TOP_RAIL + wedgeH;
        polygons.push({
          kind: 'slope',
          points: [
            { x: startX, y: TOP_RAIL },
            { x: endX, y: TOP_RAIL },
            { x: midX, y: tipY },
          ],
        });
        sim.safeCenterY = Math.max(minSafe, Math.min(maxSafe, tipY + halfGap * 0.9));
      } else {
        const tipY = BOTTOM_RAIL - wedgeH;
        polygons.push({
          kind: 'slope',
          points: [
            { x: startX, y: BOTTOM_RAIL },
            { x: midX, y: tipY },
            { x: endX, y: BOTTOM_RAIL },
          ],
        });
        sim.safeCenterY = Math.max(minSafe, Math.min(maxSafe, tipY - halfGap * 0.9));
      }
    } else if (roll < 0.9) {
      // Floating exact 45-degree diamond island forcing upper or lower split path
      const size = diff === 'hard' ? 42 : diff === 'medium' ? 38 : 32;
      endX = startX + size * 2;
      const midX = startX + size;
      const placeUpper = prevY > LOGICAL_H * 0.5;
      const diamondY = placeUpper
        ? TOP_RAIL + 78 + Math.random() * 45
        : BOTTOM_RAIL - 78 - Math.random() * 45;

      polygons.push({
        kind: 'diamond',
        points: [
          { x: midX, y: diamondY - size },
          { x: midX + size, y: diamondY },
          { x: midX, y: diamondY + size },
          { x: midX - size, y: diamondY },
        ],
      });
      sim.safeCenterY = placeUpper
        ? Math.min(maxSafe, diamondY + size + halfGap * 0.75)
        : Math.max(minSafe, diamondY - size - halfGap * 0.75);
    } else {
      // Beveled gate pillar with exact 45-degree slope tips (bevel === width / 2)
      const width = 60;
      const bevel = 30;
      endX = startX + width;
      const gateCenter = Math.max(
        minSafe,
        Math.min(maxSafe, prevY + (Math.random() - 0.5) * 110)
      );
      const topTip = gateCenter - halfGap;
      const botTip = gateCenter + halfGap;

      if (topTip > TOP_RAIL + bevel + 10) {
        polygons.push({
          kind: 'pillar',
          points: [
            { x: startX, y: TOP_RAIL },
            { x: endX, y: TOP_RAIL },
            { x: endX, y: topTip - bevel },
            { x: startX + width / 2, y: topTip },
            { x: startX, y: topTip - bevel },
          ],
        });
      }
      if (botTip < BOTTOM_RAIL - bevel - 10) {
        polygons.push({
          kind: 'pillar',
          points: [
            { x: startX, y: botTip + bevel },
            { x: startX + width / 2, y: botTip },
            { x: endX, y: botTip + bevel },
            { x: endX, y: BOTTOM_RAIL },
            { x: startX, y: BOTTOM_RAIL },
          ],
        });
      }
      sim.safeCenterY = gateCenter;
    }

    sim.obstacles.push({
      id: sim.groupIdCounter++,
      minX: startX,
      maxX: endX,
      passed: false,
      polygons,
    });

    const spacing = cfg.spacingMin + Math.random() * (cfg.spacingMax - cfg.spacingMin);
    sim.nextGenX = endX + spacing;
  }, []);

  const drawScene = useCallback(
    (nowMs: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = LOGICAL_W * dpr;
      const targetH = LOGICAL_H * dpr;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sim = simRef.current;
      const cameraX = sim.worldX - PLAYER_SCREEN_X;
      const accent = sim.accentHex || '#2563eb';
      const bpm = selectedTrack?.baseBpm || 128;
      const beatProgress = ((nowMs - sim.startMs) / 1000) * (bpm / 60);
      const beatPulse = waveStateRef.current === 'PLAYING' && !lowDetailMode
        ? Math.max(0, 1 - (beatProgress % 1) * 2.5)
        : 0;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background surface
      ctx.fillStyle = darkMode ? '#090f1d' : '#f8fafc';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Subtle parallax beat vertical grid
      const gridStep = 80;
      const offset = -(cameraX % gridStep);
      ctx.strokeStyle = darkMode
        ? `rgba(148, 163, 184, ${0.06 + beatPulse * 0.05})`
        : `rgba(100, 116, 139, ${0.08 + beatPulse * 0.05})`;
      ctx.lineWidth = 1;
      for (let gx = offset; gx < LOGICAL_W; gx += gridStep) {
        ctx.beginPath();
        ctx.moveTo(gx, TOP_RAIL);
        ctx.lineTo(gx, BOTTOM_RAIL);
        ctx.stroke();
      }
      for (let gy = TOP_RAIL + 64; gy < BOTTOM_RAIL; gy += 64) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(LOGICAL_W, gy);
        ctx.stroke();
      }

      // Top & bottom rail bands
      ctx.fillStyle = darkMode ? '#0f172a' : '#e2e8f0';
      ctx.fillRect(0, 0, LOGICAL_W, TOP_RAIL);
      ctx.fillRect(0, BOTTOM_RAIL, LOGICAL_W, LOGICAL_H - BOTTOM_RAIL);

      ctx.strokeStyle = darkMode ? '#334155' : '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, TOP_RAIL);
      ctx.lineTo(LOGICAL_W, TOP_RAIL);
      ctx.moveTo(0, BOTTOM_RAIL);
      ctx.lineTo(LOGICAL_W, BOTTOM_RAIL);
      ctx.stroke();

      // Obstacles & 45-degree slopes
      for (const group of sim.obstacles) {
        if (group.maxX < cameraX - 80 || group.minX > cameraX + LOGICAL_W + 80) {
          continue;
        }
        for (const poly of group.polygons) {
          ctx.beginPath();
          poly.points.forEach((pt, idx) => {
            const sx = pt.x - cameraX;
            if (idx === 0) ctx.moveTo(sx, pt.y);
            else ctx.lineTo(sx, pt.y);
          });
          ctx.closePath();

          if (poly.kind === 'diamond') {
            ctx.fillStyle = darkMode ? '#1e293b' : '#ffffff';
          } else {
            ctx.fillStyle = darkMode ? '#172554' : '#e2e8f0';
          }
          ctx.fill();

          ctx.lineWidth = 2.5;
          ctx.strokeStyle =
            poly.kind === 'diamond'
              ? '#f43f5e'
              : darkMode
              ? '#60a5fa'
              : '#1e293b';
          ctx.stroke();
        }
      }

      // Wave 45-degree trail
      if (sim.trail.length > 1) {
        if (!lowDetailMode) {
          ctx.save();
          ctx.lineJoin = 'miter';
          ctx.lineCap = 'round';
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.28;
          ctx.lineWidth = 11;
          ctx.beginPath();
          sim.trail.forEach((pt, idx) => {
            const sx = pt.x - cameraX;
            if (idx === 0) ctx.moveTo(sx, pt.y);
            else ctx.lineTo(sx, pt.y);
          });
          ctx.lineTo(PLAYER_SCREEN_X, sim.y);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        sim.trail.forEach((pt, idx) => {
          const sx = pt.x - cameraX;
          if (idx === 0) ctx.moveTo(sx, pt.y);
          else ctx.lineTo(sx, pt.y);
        });
        ctx.lineTo(PLAYER_SCREEN_X, sim.y);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }

      // Draw built-in GD Wave Dart unless replaced by full custom skin
      const hideDefaultDart =
        decoration !== null && decorationMode === 'skin' && waveStateRef.current !== 'CRASHED';

      if (!hideDefaultDart && waveStateRef.current !== 'CRASHED') {
        const angleRad =
          waveStateRef.current === 'READY'
            ? 0
            : sim.isHolding
            ? -Math.PI / 4
            : Math.PI / 4;

        ctx.save();
        ctx.translate(PLAYER_SCREEN_X, sim.y);
        ctx.rotate(angleRad);

        if (!lowDetailMode) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = 14;
        }

        // Classic Geometry Dash arrow dart
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-11, -10);
        ctx.lineTo(-6, 0);
        ctx.lineTo(-11, 10);
        ctx.closePath();

        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }

      // Crash particles
      for (const p of sim.crashParticles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(p.x - cameraX, p.y, 4 * p.life + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    },
    [darkMode, decoration, decorationMode, lowDetailMode, selectedTrack?.baseBpm]
  );

  const resetToReady = useCallback(
    (nextDiff?: WaveDifficulty) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      audioPlayerRef.current?.stop();
      const activeDiff = nextDiff ?? difficultyRef.current;
      if (nextDiff) {
        setDifficulty(nextDiff);
        difficultyRef.current = nextDiff;
      }

      const sim = simRef.current;
      sim.worldX = 0;
      sim.y = LOGICAL_H / 2;
      sim.isHolding = false;
      sim.obstaclesCleared = 0;
      sim.nextGenX = 520;
      sim.safeCenterY = LOGICAL_H / 2;
      sim.obstacles = [];
      sim.trail = [{ x: 0, y: LOGICAL_H / 2 }];
      sim.crashParticles = [];

      for (let i = 0; i < 6; i++) {
        generateNextObstacleChunk(activeDiff);
      }

      waveStateRef.current = 'READY';
      setWaveState('READY');
      setDistanceMeters(0);
      setObstaclesCleared(0);
      setElapsedSec(0);
      setSpritePos({ yPct: 50, angleDeg: 0 });
      drawScene(performance.now());
    },
    [drawScene, generateNextObstacleChunk]
  );

  useEffect(() => {
    resetToReady();
  }, [resetToReady]);

  useEffect(() => {
    if (waveStateRef.current === 'READY') {
      drawScene(performance.now());
    }
  }, [darkMode, decoration, decorationMode, drawScene, lowDetailMode]);

  const triggerCrash = useCallback(
    (nowMs: number) => {
      const sim = simRef.current;
      waveStateRef.current = 'CRASHED';
      setWaveState('CRASHED');
      audioPlayerRef.current?.stop();
      sfx.playDeath();

      // Spawn burst particles
      sim.crashParticles = Array.from({ length: 16 }, (_, idx) => {
        const ang = (idx / 16) * Math.PI * 2;
        const spd = 90 + Math.random() * 190;
        return {
          x: sim.worldX,
          y: sim.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1,
        };
      });

      const dist = Math.max(0, Math.round(sim.worldX / 30));
      const sec = Math.max(0, Math.round(((nowMs - sim.startMs) / 1000) * 10) / 10);
      onComplete({
        difficulty: difficultyRef.current,
        bestDistance: dist,
        bestTimeSec: sec,
        obstaclesCleared: sim.obstaclesCleared,
        achievedAt: Date.now(),
      });
    },
    [onComplete]
  );

  const stepLoop = useCallback(
    (nowMs: number) => {
      const sim = simRef.current;
      const dt = Math.min(0.033, Math.max(0.001, (nowMs - sim.lastFrameMs) / 1000));
      sim.lastFrameMs = nowMs;

      if (waveStateRef.current === 'PLAYING') {
        const cfg = DIFFICULTY_SETTINGS[difficultyRef.current];
        const speed = cfg.speedPxPerSec;

        sim.worldX += speed * dt;
        const vy = sim.isHolding ? -speed : speed;
        sim.y += vy * dt;

        // Clamp cleanly against flat ceiling/floor rails
        if (sim.y <= TOP_RAIL + WAVE_HITBOX_R) {
          sim.y = TOP_RAIL + WAVE_HITBOX_R;
        } else if (sim.y >= BOTTOM_RAIL - WAVE_HITBOX_R) {
          sim.y = BOTTOM_RAIL - WAVE_HITBOX_R;
        }

        // Trail point capture for sharp 45-degree corners
        const lastPt = sim.trail[sim.trail.length - 1];
        if (!lastPt || Math.hypot(sim.worldX - lastPt.x, sim.y - lastPt.y) >= 8) {
          sim.trail.push({ x: sim.worldX, y: sim.y });
        }
        const pruneX = sim.worldX - 300;
        while (sim.trail.length > 2 && sim.trail[1].x < pruneX) {
          sim.trail.shift();
        }

        // Stream randomized obstacles ahead
        while (sim.nextGenX < sim.worldX + LOGICAL_W + 600) {
          generateNextObstacleChunk(difficultyRef.current);
        }
        sim.obstacles = sim.obstacles.filter((g) => g.maxX > sim.worldX - 360);

        // Obstacle pass count & slope collision
        let crashed = false;
        for (const group of sim.obstacles) {
          if (!group.passed && group.maxX < sim.worldX - WAVE_HITBOX_R) {
            group.passed = true;
            sim.obstaclesCleared++;
          }
          if (
            sim.worldX + WAVE_HITBOX_R >= group.minX &&
            sim.worldX - WAVE_HITBOX_R <= group.maxX
          ) {
            for (const poly of group.polygons) {
              if (circleIntersectsPolygon(sim.worldX, sim.y, WAVE_HITBOX_R, poly.points)) {
                crashed = true;
                break;
              }
            }
          }
          if (crashed) break;
        }

        setDistanceMeters(Math.round(sim.worldX / 30));
        setObstaclesCleared(sim.obstaclesCleared);
        setElapsedSec((nowMs - sim.startMs) / 1000);
        setSpritePos({
          yPct: (sim.y / LOGICAL_H) * 100,
          angleDeg: sim.isHolding ? -45 : 45,
        });

        if (crashed) {
          triggerCrash(nowMs);
        }
      } else if (waveStateRef.current === 'CRASHED') {
        let alive = false;
        for (const p of sim.crashParticles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 2.2;
          if (p.life > 0) alive = true;
        }
        drawScene(nowMs);
        if (alive) {
          rafRef.current = requestAnimationFrame(stepLoop);
        } else {
          rafRef.current = null;
        }
        return;
      }

      drawScene(nowMs);
      if (waveStateRef.current === 'PLAYING') {
        rafRef.current = requestAnimationFrame(stepLoop);
      }
    },
    [drawScene, generateNextObstacleChunk, triggerCrash]
  );

  const startRun = useCallback(async () => {
    if (waveStateRef.current === 'LOADING_AUDIO') return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const sim = simRef.current;
    sim.worldX = 0;
    sim.y = LOGICAL_H / 2;
    sim.isHolding = false;
    sim.obstaclesCleared = 0;
    sim.nextGenX = 520;
    sim.safeCenterY = LOGICAL_H / 2;
    sim.obstacles = [];
    sim.trail = [{ x: 0, y: LOGICAL_H / 2 }];
    sim.crashParticles = [];

    for (let i = 0; i < 6; i++) {
      generateNextObstacleChunk(difficultyRef.current);
    }

    setDistanceMeters(0);
    setObstaclesCleared(0);
    setElapsedSec(0);
    setSpritePos({ yPct: 50, angleDeg: 45 });

    if (musicEnabled && selectedTrack) {
      waveStateRef.current = 'LOADING_AUDIO';
      setWaveState('LOADING_AUDIO');
      try {
        let buffer: AudioBuffer;
        if (selectedTrack.sourceType === 'synth' && selectedTrack.synthPresetId) {
          const rendered = await renderSynthTrack(selectedTrack.synthPresetId);
          buffer = rendered.buffer;
        } else if (selectedTrack.audioBuffer) {
          buffer = selectedTrack.audioBuffer;
        } else {
          throw new Error('No audio buffer');
        }
        audioPlayerRef.current?.start(buffer, 'normal', 0, undefined, true);
      } catch {
        // Proceed cleanly even if audio fails
      }
    }

    const now = performance.now();
    sim.startMs = now;
    sim.lastFrameMs = now;
    waveStateRef.current = 'PLAYING';
    setWaveState('PLAYING');
    sfx.playLevelStart();
    rafRef.current = requestAnimationFrame(stepLoop);
  }, [generateNextObstacleChunk, musicEnabled, selectedTrack, stepLoop]);

  const setHoldInput = useCallback(
    (holding: boolean) => {
      if (waveStateRef.current !== 'PLAYING') return;
      const sim = simRef.current;
      if (sim.isHolding !== holding) {
        sim.isHolding = holding;
        sim.trail.push({ x: sim.worldX, y: sim.y });
      }
    },
    []
  );

  // Keyboard Wave controls (Space / ArrowUp / W)
  useEffect(() => {
    const isWaveKey = (code: string) =>
      code === 'Space' || code === 'ArrowUp' || code === 'KeyW';

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isWaveKey(e.code)) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      if (e.repeat) return;

      if (waveStateRef.current === 'READY' || waveStateRef.current === 'CRASHED') {
        void startRun().then(() => {
          simRef.current.isHolding = true;
        });
        return;
      }
      setHoldInput(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isWaveKey(e.code)) return;
      setHoldInput(false);
    };

    const onBlur = () => setHoldInput(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [setHoldInput, startRun]);

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!customMediaAllowed) {
      setUploadAudioError('Custom audio uploads are disabled by Parental Controls.');
      return;
    }

    setUploadAudioError(null);
    if (!checkPolicyContent(file.name).allowed) {
      setUploadAudioError('Explicit/offensive audio violates Policy Agreements.');
      await triggerBan(
        'Policy violation: attempted to play explicit audio.',
        'Policy violation ban'
      );
      return;
    }

    try {
      const uploaded = await decodeAndAnalyzeAudioFile(file);
      setTracks((prev) => [uploaded, ...prev.filter((t) => t.id !== uploaded.id)]);
      setSelectedTrackId(uploaded.id);
      setMusicEnabled(true);
    } catch {
      setUploadAudioError('Could not decode that audio file. Please use MP3, WAV, OGG, or M4A.');
    }
  };

  const handleDecorationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!customMediaAllowed) {
      setDecorationError('Custom image uploads are disabled by Parental Controls.');
      return;
    }

    setDecorationError(null);
    if (!checkPolicyContent(file.name).allowed) {
      setDecorationError('Explicit/offensive images violate Policy Agreements.');
      await triggerBan(
        'Policy violation: attempted to upload explicit wave image.',
        'Policy violation ban'
      );
      return;
    }

    const validMime = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
    ].includes(file.type.toLowerCase());
    const validExt = /\.(png|jpe?g|gif)$/i.test(file.name);

    if (!validMime && !validExt) {
      setDecorationError('Please choose a PNG, JPG, JPEG, or GIF file.');
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
      setDecoration(asset);
      await saveMediaAsset('wave_decoration', asset);
    } catch {
      setDecorationError('Unable to read image file.');
    }
  };

  const clearDecoration = async () => {
    setDecoration(null);
    await deleteMediaAsset('wave_decoration');
    setConfirmClearModal(false);
  };

  const currentBest = bestRecords[difficulty];
  const playerLeftPct = (PLAYER_SCREEN_X / LOGICAL_W) * 100;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Heartbeat Wave Challenge
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Hold Click, Space, W, or Up Arrow to fly upward at 45° and release to dive at 45° past randomized 45° slopes.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          {(['easy', 'medium', 'hard'] as const).map((diff) => (
            <button
              key={diff}
              type="button"
              onClick={() => {
                sfx.playUiTick();
                resetToReady(diff);
              }}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                difficulty === diff
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {DIFFICULTY_SETTINGS[diff].label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Distance</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums accent-text">
            {distanceMeters}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">m</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Slopes Cleared</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {obstaclesCleared}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Survival Time</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {elapsedSec.toFixed(1)}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">s</span>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {DIFFICULTY_SETTINGS[difficulty].label} Best
          </div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {currentBest ? currentBest.bestDistance : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">m</span>
          </div>
        </div>
      </div>

      {/* Interactive Wave Stage */}
      <div
        data-no-global-pulse="true"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (waveState === 'PLAYING') {
            setHoldInput(true);
          }
        }}
        onPointerUp={() => setHoldInput(false)}
        onPointerLeave={() => setHoldInput(false)}
        onPointerCancel={() => setHoldInput(false)}
        className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden select-none touch-none"
      >
        <div className="relative w-full" style={{ aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}` }}>
          <canvas ref={canvasRef} className="block w-full h-full cursor-pointer" />

          {/* Synchronized PNG / JPG / JPEG / animated GIF Wave Decoration */}
          {decoration && customMediaAllowed && waveState !== 'CRASHED' && (
            <img
              src={decoration.dataUrl}
              alt="Custom wave decoration"
              style={{
                left: `${playerLeftPct}%`,
                top: `${spritePos.yPct}%`,
                transform: `translate(${
                  decorationMode === 'badge' ? '-115%' : '-50%'
                }, -50%) rotate(${
                  tiltDecoration && waveState === 'PLAYING' ? spritePos.angleDeg : 0
                }deg)`,
              }}
              className={`pointer-events-none absolute object-contain transition-transform duration-75 ${
                decorationMode === 'skin'
                  ? 'w-9 h-9 sm:w-11 sm:h-11 rounded-md drop-shadow-md'
                  : 'w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white dark:border-slate-900 shadow-sm'
              }`}
            />
          )}

          {waveState === 'READY' && (
            <div className="absolute inset-0 bg-slate-950/35 dark:bg-slate-950/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="text-xs font-mono uppercase tracking-wider text-white/90 font-semibold">
                {DIFFICULTY_SETTINGS[difficulty].label} Mode · {DIFFICULTY_SETTINGS[difficulty].subtitle}
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">
                45° Wave Corridor
              </h2>
              <p className="text-sm text-white/85 max-w-md">
                Hold Mouse / Touch / Space / W to ascend at 45°. Release to descend at 45°. Avoid randomized slopes and diamonds.
              </p>
              <button
                type="button"
                onClick={() => void startRun()}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white accent-bg rounded-lg shadow-lg transition-transform active:scale-[0.97] cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>Launch Wave</span>
              </button>
            </div>
          )}

          {waveState === 'LOADING_AUDIO' && (
            <div className="absolute inset-0 bg-slate-950/50 flex items-center justify-center text-sm font-semibold text-white">
              Loading selected music track...
            </div>
          )}

          {waveState === 'CRASHED' && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="text-xs font-mono uppercase tracking-wider text-rose-300 font-semibold">
                Wave Crashed · {DIFFICULTY_SETTINGS[difficulty].label} Mode
              </div>
              <h2 className="text-3xl font-mono font-bold tabular-nums text-white">
                {distanceMeters}m · {obstaclesCleared} Slopes Cleared
              </h2>
              <p className="text-xs font-mono text-white/80">
                Survived {elapsedSec.toFixed(1)}s · Press Space or click Retry
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startRun()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Retry Wave</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    resetToReady();
                  }}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Setup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Music & Wave Decoration Customization */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Music Selection */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Music2 className="w-4 h-4 accent-text shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Wave Music (Site or Local)
              </h2>
            </div>

            <button
              type="button"
              onClick={() => {
                sfx.playUiTick();
                setMusicEnabled((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                musicEnabled
                  ? 'accent-bg border-transparent text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {musicEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{musicEnabled ? 'Music On' : 'Muted'}</span>
            </button>
          </div>

          <div className="space-y-2">
            {tracks.map((track) => {
              const active = selectedTrackId === track.id;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    setSelectedTrackId(track.id);
                    setMusicEnabled(true);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {track.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {track.subtitle}
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold accent-text ml-3 shrink-0">
                    {active ? 'Selected' : 'Select'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            {customMediaAllowed ? (
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Local Audio (MP3/WAV/OGG)</span>
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                  onChange={handleAudioUpload}
                  className="sr-only"
                />
              </label>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg whitespace-nowrap shrink-0">
                Local audio disabled by Parental Controls
              </span>
            )}
            {uploadAudioError && (
              <span className="text-xs text-rose-600 dark:text-rose-400">{uploadAudioError}</span>
            )}
          </div>
        </section>

        {/* Wave Image/GIF Decoration */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 accent-text shrink-0" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Wave Decoration (PNG / JPG / JPEG / GIF)
            </h2>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Import any local PNG, JPG, JPEG, or animated GIF to customize your Wave dart or attach an emblem beside it. Saved locally in your browser.
          </p>

          <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div className="w-16 h-16 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
              {decoration ? (
                <img
                  src={decoration.dataUrl}
                  alt={decoration.fileName}
                  className="w-full h-full object-contain"
                />
              ) : (
                <ImagePlus className="w-6 h-6 text-slate-400" />
              )}
            </div>

            <div className="flex-1 min-w-[160px] space-y-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {decoration ? decoration.fileName : 'Default Heartbeat Wave Dart'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {customMediaAllowed ? (
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white accent-bg rounded-lg transition-transform active:scale-[0.97] cursor-pointer whitespace-nowrap shrink-0">
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{decoration ? 'Replace Image / GIF' : 'Import PNG / JPG / GIF'}</span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif"
                      onChange={handleDecorationUpload}
                      className="sr-only"
                    />
                  </label>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg whitespace-nowrap shrink-0">
                    Disabled by Parental Controls
                  </span>
                )}

                {decoration && (
                  <button
                    type="button"
                    onClick={() => {
                      sfx.playUiTick();
                      setConfirmClearModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {decorationError && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{decorationError}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  setDecorationMode('skin');
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  decorationMode === 'skin'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Full Wave Skin
              </button>
              <button
                type="button"
                onClick={() => {
                  sfx.playUiTick();
                  setDecorationMode('badge');
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  decorationMode === 'badge'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Badge Beside Arrow
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                sfx.playUiTick();
                setTiltDecoration((prev) => !prev);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                tiltDecoration
                  ? 'accent-bg border-transparent text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {tiltDecoration ? '45° Tilt: On' : '45° Tilt: Off'}
            </button>
          </div>
        </section>
      </div>

      <GameLeaderboardPanel
        boardKey={`wave_${difficulty}` as BoardKey}
        localPayload={
          bestRecords[difficulty]
            ? waveRecordToPayload(bestRecords[difficulty]!)
            : null
        }
        onOpenFullLeaderboards={onOpenLeaderboards}
      />

      <PasswordConfirmModal
        open={confirmClearModal}
        title="Delete Wave Decoration"
        description="Enter your account password to delete your saved Wave image/GIF decoration."
        confirmLabel="Verify & Clear"
        onCancel={() => setConfirmClearModal(false)}
        onConfirmed={clearDecoration}
      />
    </div>
  );
}
