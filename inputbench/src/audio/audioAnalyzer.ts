import { RemixMode, RhythmTrack } from '../types/benchmark';
import { getRemixPlaybackRate } from './synthTracks';

export async function decodeAndAnalyzeAudioFile(file: File): Promise<RhythmTrack> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await ctx.close().catch(() => {});
  }

  const onsets = detectAudioOnsets(audioBuffer);
  const baseBpm = estimateBpmFromOnsets(onsets);
  const cleanTitle = file.name.replace(/\.[^/.]+$/, '').trim() || 'Uploaded Track';

  return {
    id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    subtitle: `Local Audio · ~${baseBpm} BPM`,
    sourceType: 'upload',
    baseBpm,
    durationSec: audioBuffer.duration,
    audioBuffer,
    baseOnsetsSec: onsets,
  };
}

function detectAudioOnsets(buffer: AudioBuffer): number[] {
  const sampleRate = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  const frameSize = 1024;
  const hopSize = 512;
  const frameDuration = hopSize / sampleRate;
  const numFrames = Math.floor((ch0.length - frameSize) / hopSize);
  if (numFrames <= 4) return [];

  const energies = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const sample = ch1 ? (ch0[start + i] + ch1[start + i]) * 0.5 : ch0[start + i];
      sumSq += sample * sample;
    }
    energies[f] = Math.sqrt(sumSq / frameSize);
  }

  // Positive first-order energy flux emphasizes percussive/rhythmic attacks
  const flux = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const diff = energies[f] - energies[f - 1];
    flux[f] = diff > 0 ? diff : 0;
  }

  // Adaptive sliding threshold
  const windowRadius = 18;
  const minOnsetGapSec = 0.145;
  const onsets: number[] = [];
  let lastOnsetTime = -1;

  for (let f = 2; f < numFrames - 2; f++) {
    const timeSec = f * frameDuration;
    if (timeSec < 0.7 || timeSec > buffer.duration - 0.5) continue;

    // Local peak check
    if (flux[f] <= flux[f - 1] || flux[f] < flux[f + 1]) continue;

    const wStart = Math.max(0, f - windowRadius);
    const wEnd = Math.min(numFrames - 1, f + windowRadius);
    let sum = 0;
    let count = 0;
    for (let j = wStart; j <= wEnd; j++) {
      sum += flux[j];
      count++;
    }
    const mean = sum / count;

    let varSum = 0;
    for (let j = wStart; j <= wEnd; j++) {
      const d = flux[j] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / count);
    const threshold = mean + std * 1.25 + 0.008;

    if (flux[f] > threshold && timeSec - lastOnsetTime >= minOnsetGapSec) {
      onsets.push(Math.round(timeSec * 1000) / 1000);
      lastOnsetTime = timeSec;
    }
  }

  // Fallback regular beat grid if track is ultra-ambient with few sharp transients
  if (onsets.length < Math.max(8, Math.floor(buffer.duration / 2))) {
    const fallback: number[] = [];
    for (let t = 1.0; t < buffer.duration - 0.8; t += 0.5) {
      fallback.push(Math.round(t * 1000) / 1000);
    }
    return fallback;
  }

  return onsets;
}

function estimateBpmFromOnsets(onsets: number[]): number {
  if (onsets.length < 4) return 120;
  const bins = new Map<number, number>();
  for (let i = 1; i < Math.min(onsets.length, 140); i++) {
    const ioi = onsets[i] - onsets[i - 1];
    if (ioi < 0.24 || ioi > 1.0) continue;
    let bpm = Math.round(60 / ioi);
    while (bpm < 85) bpm *= 2;
    while (bpm > 175) bpm = Math.round(bpm / 2);
    const quantized = Math.round(bpm / 2) * 2;
    bins.set(quantized, (bins.get(quantized) ?? 0) + 1);
  }
  let bestBpm = 120;
  let bestCount = 0;
  for (const [bpm, count] of bins.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestBpm = bpm;
    }
  }
  return bestBpm;
}

export class RhythmAudioPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;

  private isPlaying = false;
  private playbackRate = 1.0;
  private startCtxTime = 0;
  private pausedPlaybackSec = 0;
  private totalRemixDurationSec = 0;

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public start(
    buffer: AudioBuffer,
    remix: RemixMode,
    fromPlaybackSec = 0,
    onEnded?: () => void,
    loop = false
  ): void {
    this.stopSourceOnly();
    const ctx = this.ensureContext();
    const rate = getRemixPlaybackRate(remix);
    this.playbackRate = rate;
    this.totalRemixDurationSec = buffer.duration / rate;
    this.pausedPlaybackSec = Math.max(0, fromPlaybackSec);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.setValueAtTime(rate, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.88, ctx.currentTime);

    if (remix === 'nightcore') {
      // Bright airy top-end boost for Nightcore energy
      filter.type = 'highshelf';
      filter.frequency.setValueAtTime(3800, ctx.currentTime);
      filter.gain.setValueAtTime(3.5, ctx.currentTime);
      source.connect(filter);
      filter.connect(masterGain);
    } else if (remix === 'lofi') {
      // Warm muffled low-pass filter for Half-Time Lo-Fi feel
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2150, ctx.currentTime);
      filter.Q.setValueAtTime(0.85, ctx.currentTime);
      source.connect(filter);
      filter.connect(masterGain);
    } else {
      // Clean unprocessed signal for Normal 1.00x speed
      source.connect(masterGain);
    }

    masterGain.connect(ctx.destination);

    const bufferOffset = Math.min(buffer.duration - 0.05, Math.max(0, fromPlaybackSec * rate));
    this.startCtxTime = ctx.currentTime;
    this.isPlaying = true;

    source.onended = () => {
      if (this.source === source && this.isPlaying && !loop) {
        this.isPlaying = false;
        onEnded?.();
      }
    };

    source.start(0, bufferOffset);
    this.source = source;
    this.filterNode = filter;
    this.masterGain = masterGain;
  }

  public pause(): number {
    const current = this.getCurrentTimeSec();
    this.pausedPlaybackSec = current;
    this.stopSourceOnly();
    this.isPlaying = false;
    return current;
  }

  public stop(): void {
    this.stopSourceOnly();
    this.isPlaying = false;
    this.pausedPlaybackSec = 0;
  }

  public dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }

  private stopSourceOnly(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // Already stopped
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.filterNode) {
      this.filterNode.disconnect();
      this.filterNode = null;
    }
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
  }

  public getCurrentTimeSec(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.pausedPlaybackSec;
    }
    const elapsed = Math.max(0, this.ctx.currentTime - this.startCtxTime);
    return Math.min(this.totalRemixDurationSec, this.pausedPlaybackSec + elapsed);
  }

  public playHitSound(lane: 0 | 1): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = lane === 0 ? 740 : 880;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }
}
