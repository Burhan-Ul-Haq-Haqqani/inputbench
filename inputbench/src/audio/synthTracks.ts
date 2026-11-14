import { NoteEvent, RemixMode, RhythmTrack, SynthPresetId } from '../types/benchmark';

export const BUILTIN_SYNTH_TRACKS: RhythmTrack[] = [
  {
    id: 'synth-solar-pulse',
    title: 'Solar Pulse',
    subtitle: 'Electro Synth · 128 BPM',
    sourceType: 'synth',
    baseBpm: 128,
    durationSec: 32,
    synthPresetId: 'solar-pulse',
  },
  {
    id: 'synth-clockwork-grid',
    title: 'Clockwork Grid',
    subtitle: 'Kinetic Chiptune · 140 BPM',
    sourceType: 'synth',
    baseBpm: 140,
    durationSec: 32,
    synthPresetId: 'clockwork-grid',
  },
  {
    id: 'synth-velvet-horizon',
    title: 'Velvet Horizon',
    subtitle: 'Melodic Keys · 112 BPM',
    sourceType: 'synth',
    baseBpm: 112,
    durationSec: 34,
    synthPresetId: 'velvet-horizon',
  },
];

const synthBufferCache = new Map<SynthPresetId, { buffer: AudioBuffer; onsets: number[] }>();

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createNoiseBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function triggerKick(ctx: OfflineAudioContext, dest: AudioNode, time: number, punch = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(145, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);

  gain.gain.setValueAtTime(0.55 * punch, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.24);
}

function triggerSnare(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  time: number,
  level = 0.28
) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1900, time);
  filter.Q.setValueAtTime(0.8, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(level, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(dest);
  noise.start(time);
  noise.stop(time + 0.15);

  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(195, time);
  body.frequency.exponentialRampToValueAtTime(105, time + 0.08);
  bodyGain.gain.setValueAtTime(level * 0.85, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
  body.connect(bodyGain);
  bodyGain.connect(dest);
  body.start(time);
  body.stop(time + 0.1);
}

function triggerHat(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  time: number,
  open = false,
  level = 0.11
) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(6800, time);

  const gain = ctx.createGain();
  const dur = open ? 0.13 : 0.045;
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  noise.start(time);
  noise.stop(time + dur + 0.01);
}

function triggerSynthVoice(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  midi: number,
  time: number,
  duration: number,
  type: OscillatorType,
  level: number,
  cutoffHz = 3600
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(midiToFreq(midi), time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoffHz, time);
  filter.frequency.exponentialRampToValueAtTime(Math.max(450, cutoffHz * 0.45), time + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(level, time + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0008, time + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

export async function renderSynthTrack(
  presetId: SynthPresetId
): Promise<{ buffer: AudioBuffer; onsets: number[] }> {
  const cached = synthBufferCache.get(presetId);
  if (cached) return cached;

  const trackMeta = BUILTIN_SYNTH_TRACKS.find((t) => t.synthPresetId === presetId)!;
  const bpm = trackMeta.baseBpm;
  const durationSec = trackMeta.durationSec;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * durationSec), sampleRate);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.75, 0);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-12, 0);
  compressor.ratio.setValueAtTime(4, 0);
  master.connect(compressor);
  compressor.connect(ctx.destination);

  const noiseBuffer = createNoiseBuffer(ctx, 0.25);
  const stepSec = 60 / bpm / 4; // 16th note step
  const totalSteps = Math.floor((durationSec - 1.2) / stepSec);
  const leadInSec = 0.8;
  const onsets: number[] = [];

  if (presetId === 'solar-pulse') {
    const chords = [
      [53, 57, 60, 64], // Fmaj7
      [55, 59, 62, 67], // G6
      [52, 55, 59, 64], // Em7
      [57, 60, 64, 69], // Am7
    ];
    const bassRoots = [41, 43, 40, 45];
    const leadPattern = [0, 2, 3, 2, 1, 3, 2, 0, 1, 2, 3, 1, 2, 3, 2, 1];

    for (let s = 0; s < totalSteps; s++) {
      const t = leadInSec + s * stepSec;
      const bar = Math.floor(s / 16) % chords.length;
      const stepInBar = s % 16;
      const chord = chords[bar];
      const bass = bassRoots[bar];

      if (stepInBar % 4 === 0) {
        triggerKick(ctx, master, t, 1.0);
        onsets.push(t);
      }
      if (stepInBar === 4 || stepInBar === 12) {
        triggerSnare(ctx, master, noiseBuffer, t, 0.25);
      }
      if (stepInBar % 2 === 1) {
        triggerHat(ctx, master, noiseBuffer, t, stepInBar === 10, 0.09);
      }

      // Driving offbeat synth bass
      if (stepInBar % 2 === 0) {
        const octave = stepInBar % 4 === 2 ? 12 : 0;
        triggerSynthVoice(ctx, master, bass + octave, t, stepSec * 1.7, 'sawtooth', 0.16, 1100);
      }

      // Pad on beat 1 of each bar
      if (stepInBar === 0) {
        for (const note of chord) {
          triggerSynthVoice(ctx, master, note, t, stepSec * 14, 'triangle', 0.06, 1800);
        }
      }

      // Melodic arpeggio notes and gameplay hits
      const playLead =
        stepInBar === 0 ||
        stepInBar === 3 ||
        stepInBar === 6 ||
        stepInBar === 8 ||
        stepInBar === 10 ||
        stepInBar === 14 ||
        (bar % 2 === 1 && stepInBar === 12);

      if (playLead) {
        const note = chord[leadPattern[stepInBar] % chord.length] + 12;
        triggerSynthVoice(ctx, master, note, t, stepSec * 2.1, 'sawtooth', 0.13, 4200);
        if (stepInBar % 4 !== 0) {
          onsets.push(t);
        }
      }
    }
  } else if (presetId === 'clockwork-grid') {
    const prog = [
      [50, 53, 57, 62], // Dm
      [46, 50, 53, 58], // Bb
      [48, 52, 55, 60], // C
      [45, 49, 52, 57], // A
    ];
    const melodySteps = [0, 2, 4, 6, 7, 8, 10, 12, 14, 15];

    for (let s = 0; s < totalSteps; s++) {
      const t = leadInSec + s * stepSec;
      const bar = Math.floor(s / 16) % prog.length;
      const stepInBar = s % 16;
      const chord = prog[bar];

      if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14) {
        triggerKick(ctx, master, t, 0.95);
        onsets.push(t);
      }
      if (stepInBar === 4 || stepInBar === 12) {
        triggerSnare(ctx, master, noiseBuffer, t, 0.28);
        onsets.push(t);
      }
      if (stepInBar % 2 === 0) {
        triggerHat(ctx, master, noiseBuffer, t, false, 0.08);
      }

      // Chiptune square bass
      if (stepInBar % 2 === 0) {
        const pitch = chord[0] - 12 + (stepInBar % 4 === 2 ? 12 : 0);
        triggerSynthVoice(ctx, master, pitch, t, stepSec * 1.4, 'square', 0.11, 1400);
      }

      if (melodySteps.includes(stepInBar)) {
        const idx = (stepInBar + bar) % chord.length;
        const note = chord[idx] + 24;
        triggerSynthVoice(ctx, master, note, t, stepSec * 1.6, 'square', 0.09, 3800);
        if (![0, 4, 6, 8, 12, 14].includes(stepInBar)) {
          onsets.push(t);
        }
      }
    }
  } else {
    // Velvet Horizon - warm Rhodes-style chord groove
    const prog = [
      [48, 55, 59, 62, 64], // Cmaj9
      [45, 52, 55, 59, 60], // Am9
      [41, 48, 52, 57, 60], // Fmaj7
      [43, 50, 55, 59, 62], // G6
    ];

    for (let s = 0; s < totalSteps; s++) {
      const t = leadInSec + s * stepSec;
      const bar = Math.floor(s / 16) % prog.length;
      const stepInBar = s % 16;
      const chord = prog[bar];

      if (stepInBar === 0 || stepInBar === 10) {
        triggerKick(ctx, master, t, 0.9);
        onsets.push(t);
      }
      if (stepInBar === 4 || stepInBar === 12) {
        triggerSnare(ctx, master, noiseBuffer, t, 0.2);
        onsets.push(t);
      }
      if (stepInBar % 2 === 0) {
        triggerHat(ctx, master, noiseBuffer, t, stepInBar === 14, 0.065);
      }

      if (stepInBar === 0 || stepInBar === 8) {
        triggerSynthVoice(ctx, master, chord[0] - 12, t, stepSec * 7, 'sine', 0.24, 900);
      }

      if (stepInBar === 0 || stepInBar === 6 || stepInBar === 12) {
        for (const n of chord.slice(1)) {
          triggerSynthVoice(ctx, master, n, t, stepSec * 5.2, 'triangle', 0.075, 2100);
        }
      }

      if (stepInBar === 2 || stepInBar === 6 || stepInBar === 9 || stepInBar === 14) {
        const bellNote = chord[(stepInBar + bar) % chord.length] + 12;
        triggerSynthVoice(ctx, master, bellNote, t, stepSec * 3.0, 'sine', 0.14, 4800);
        onsets.push(t);
      }
    }
  }

  const buffer = await ctx.startRendering();
  const uniqueOnsets = Array.from(new Set(onsets.map((t) => Math.round(t * 1000) / 1000))).sort(
    (a, b) => a - b
  );
  const result = { buffer, onsets: uniqueOnsets };
  synthBufferCache.set(presetId, result);
  return result;
}

export function getRemixPlaybackRate(remix: RemixMode): number {
  if (remix === 'nightcore') return 1.3;
  if (remix === 'lofi') return 0.72;
  return 1.0;
}

export function generateRemixChart(
  baseOnsetsSec: number[],
  remix: RemixMode,
  trackDurationSec: number
): NoteEvent[] {
  const rate = getRemixPlaybackRate(remix);
  const minSpacing = remix === 'nightcore' ? 0.12 : remix === 'lofi' ? 0.26 : 0.16;
  const maxPlaybackTime = trackDurationSec / rate - 0.5;

  // Convert base audio timestamps to real-time playback seconds
  const scaled = baseOnsetsSec
    .map((t) => t / rate)
    .filter((t) => t >= 0.75 && t <= maxPlaybackTime);

  const filtered: number[] = [];
  for (const t of scaled) {
    if (filtered.length === 0 || t - filtered[filtered.length - 1] >= minSpacing) {
      filtered.push(t);
    }
  }

  // For Nightcore, enrich longer gaps (> 0.52s) with a clean mid-beat syncopation note
  const enriched: number[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const curr = filtered[i];
    enriched.push(curr);
    if (remix === 'nightcore' && i < filtered.length - 1) {
      const gap = filtered[i + 1] - curr;
      if (gap >= 0.44 && gap <= 0.95) {
        enriched.push(curr + gap * 0.5);
      }
    }
  }

  // Assign 2-key lanes with hold falling notes on sustained phrases and zero same-lane overlap
  const notes: NoteEvent[] = [];
  let currentLane: 0 | 1 = 0;
  let streak = 0;
  let idCounter = 1;
  const laneBusyUntil: [number, number] = [0, 0];

  for (let i = 0; i < enriched.length; i++) {
    const timeSec = Math.round(enriched[i] * 1000) / 1000;
    const prevTime = i > 0 ? enriched[i - 1] : 0;
    const delta = timeSec - prevTime;
    const nextTime = i < enriched.length - 1 ? enriched[i + 1] : maxPlaybackTime;
    const gapAfter = nextTime - timeSec;

    if (delta < 0.22) {
      currentLane = currentLane === 0 ? 1 : 0;
      streak = 1;
    } else if (streak >= 2 || i % 3 !== 0) {
      currentLane = currentLane === 0 ? 1 : 0;
      streak = 1;
    } else {
      streak++;
    }

    // Ensure chosen lane is not currently occupied by an active hold note
    let chosenLane: 0 | 1 = currentLane;
    if (laneBusyUntil[chosenLane] > timeSec - 0.08) {
      const otherLane: 0 | 1 = chosenLane === 0 ? 1 : 0;
      if (laneBusyUntil[otherLane] <= timeSec - 0.08) {
        chosenLane = otherLane;
      } else {
        continue;
      }
    }

    const minHoldGap = remix === 'lofi' ? 0.54 : 0.44;
    const canPlaceHold =
      i > 1 &&
      gapAfter >= minHoldGap &&
      timeSec + 0.45 < maxPlaybackTime &&
      i % 4 === 2;

    if (canPlaceHold) {
      const maxSpanToNext = Math.max(0.32, gapAfter - 0.14);
      const durationSec = Math.round(Math.min(1.25, maxSpanToNext) * 1000) / 1000;
      notes.push({
        id: idCounter++,
        timeSec,
        lane: chosenLane,
        durationSec,
      });
      laneBusyUntil[chosenLane] = timeSec + durationSec + 0.12;
      continue;
    }

    notes.push({
      id: idCounter++,
      timeSec,
      lane: chosenLane,
    });
    laneBusyUntil[chosenLane] = timeSec + 0.06;

    // Occasional 2-key chord hit on strong downbeats in Nightcore when both lanes are free
    if (remix === 'nightcore' && i > 0 && i % 12 === 0 && delta > 0.25) {
      const otherLane: 0 | 1 = chosenLane === 0 ? 1 : 0;
      if (laneBusyUntil[otherLane] <= timeSec - 0.08) {
        notes.push({
          id: idCounter++,
          timeSec,
          lane: otherLane,
        });
        laneBusyUntil[otherLane] = timeSec + 0.06;
      }
    }
  }

  return notes;
}
