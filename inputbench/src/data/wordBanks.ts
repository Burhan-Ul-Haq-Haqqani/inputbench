import { WordDifficulty } from '../types/benchmark';

export interface WordDifficultyConfig {
  label: string;
  sample: string;
  words: string[];
  spellingWords: string[];
}

export const WORD_DIFFICULTY_META: Record<WordDifficulty, WordDifficultyConfig> = {
  easy: {
    label: 'Easy',
    sample: 'yes',
    words: [
      'yes', 'no', 'go', 'up', 'run', 'key', 'tap', 'box', 'dot', 'mix',
      'day', 'sky', 'top', 'end', 'win', 'try', 'red', 'sun', 'air', 'bit',
      'map', 'set', 'hit', 'two', 'fast', 'play', 'beat', 'note', 'time', 'code',
    ],
    // Unambiguous spoken words (avoid homophones like no/know, two/to, sun/son, air/heir, red/read)
    spellingWords: [
      'yes', 'cat', 'play', 'home', 'fast', 'jump', 'book', 'star', 'desk', 'tree',
      'hand', 'gold', 'wind', 'lamp', 'milk', 'door', 'frog', 'park', 'ship', 'cake',
      'rain', 'song', 'bird', 'clock', 'cloud', 'smile', 'stone', 'plant', 'chair', 'green',
    ],
  },
  medium: {
    label: 'Medium',
    sample: 'kinetic',
    words: [
      'balance', 'capture', 'kinetic', 'channel', 'latency', 'monitor',
      'trigger', 'pattern', 'velocity', 'rhythm', 'network', 'browser',
      'process', 'digital', 'surface', 'profile', 'display', 'current',
      'project', 'control', 'signal', 'buffer', 'vector', 'syntax',
    ],
    spellingWords: [
      'kinetic', 'balance', 'capture', 'channel', 'latency', 'monitor',
      'pattern', 'velocity', 'rhythm', 'network', 'browser', 'digital',
      'surface', 'profile', 'display', 'project', 'control', 'bracket',
      'whisper', 'library', 'horizon', 'gallery', 'compass', 'lantern',
      'journey', 'gravity', 'harvest', 'thunder', 'mystery', 'captain',
    ],
  },
  hard: {
    label: 'Hard',
    sample: 'calibration',
    words: [
      'calibration', 'consistency', 'methodology', 'performance',
      'benchmarking', 'acceleration', 'coordination', 'oscillation',
      'architecture', 'differential', 'configuration', 'implementation',
      'synchronization', 'troubleshooting', 'responsiveness', 'authentication',
      'visualization', 'infrastructure',
    ],
    spellingWords: [
      'calibration', 'consistency', 'methodology', 'performance',
      'benchmarking', 'acceleration', 'coordination', 'oscillation',
      'architecture', 'differential', 'configuration', 'implementation',
      'synchronization', 'troubleshooting', 'responsiveness', 'authentication',
      'visualization', 'infrastructure', 'surveillance', 'millennium',
      'entrepreneur', 'conscientious', 'accommodate', 'maintenance',
      'fluorescence', 'recommendation', 'questionnaire', 'perseverance',
    ],
  },
  extreme: {
    label: 'Extreme',
    sample: 'Conceptualization',
    words: [
      'Conceptualization',
      'Microarchitecture',
      'Telecommunications',
      'Counterproductive',
      'Multidimensional',
      'Uncharacteristically',
      'Interdisciplinary',
      'Incomprehensible',
      'Hypersensitivity',
      'Instrumentation',
      'Deconstructionist',
      'Thermodynamics',
      'Compartmentalization',
      'Electroencephalography',
      'Disproportionately',
      'Overcompensation',
    ],
    spellingWords: [
      'Conceptualization',
      'Microarchitecture',
      'Telecommunications',
      'Counterproductive',
      'Multidimensional',
      'Uncharacteristically',
      'Interdisciplinary',
      'Incomprehensible',
      'Hypersensitivity',
      'Instrumentation',
      'Deconstructionist',
      'Thermodynamics',
      'Compartmentalization',
      'Electroencephalography',
      'Disproportionately',
      'Overcompensation',
      'Misinterpretation',
      'Institutionalization',
      'Counterintelligence',
      'Hyperventilation',
    ],
  },
};

export function pickRandomWord(
  difficulty: WordDifficulty,
  mode: 'typing' | 'spelling',
  exclude?: string,
  preferAnchor = false
): string {
  const meta = WORD_DIFFICULTY_META[difficulty];
  const list = mode === 'spelling' ? meta.spellingWords : meta.words;
  if (preferAnchor) {
    if (difficulty === 'easy') return 'yes';
    if (difficulty === 'extreme') return 'Conceptualization';
  }
  const pool = list.filter((w) => w.toLowerCase() !== exclude?.toLowerCase());
  return pool[Math.floor(Math.random() * pool.length)] ?? list[0];
}
