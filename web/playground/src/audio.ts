// Consumer-owned translation from audio settings to Web Audio commands. The browser's Web Audio
// API owns playback, mixing and the output device (as it does for media-player); this module only
// turns setting values into bus gains and the context sample rate. Output-device selection has
// no existing abstraction to consume, so the playground reports it as unsupported.
import type { SettingValue } from '@moritzbrantner/settings-browser';

/** Audio settings previewed immediately while staged: Cancel reverts them, Apply keeps them. */
export const PREVIEWED_AUDIO = ['audio.master_volume', 'audio.music_volume', 'audio.effects_volume', 'audio.mute'];

export interface AudioMix {
  /** Linear gains in 0..1; `master` is 0 while muted so the bus levels are preserved. */
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

export function audioMix(values: Readonly<Record<string, SettingValue | undefined>>): AudioMix {
  const percent = (id: string, fallback: number) => {
    const value = values[id];
    return (value?.type === 'integer' || value?.type === 'number' ? value.value : fallback) / 100;
  };
  const mute = values['audio.mute'];
  const muted = mute?.type === 'bool' && mute.value;
  return {
    master: muted ? 0 : percent('audio.master_volume', 80),
    music: percent('audio.music_volume', 100),
    effects: percent('audio.effects_volume', 100),
    muted,
  };
}

export function sampleRateOf(values: Readonly<Record<string, SettingValue | undefined>>): number {
  const value = values['audio.sample_rate'];
  const rate = value?.type === 'choice' ? Number(value.value) : NaN;
  return Number.isFinite(rate) ? rate : 48_000;
}

/** A generated two-bus demo: a sustained chord on the music bus and a pulsing beep on effects. */
export interface AudioDemo {
  readonly sampleRate: number;
  setMix(mix: AudioMix): void;
  gains(): { master: number; music: number; effects: number };
  /** Root-mean-square output level of the most recent analyser frame. */
  level(): number;
  close(): Promise<void>;
}

export function createAudioDemo(sampleRate: number, mix: AudioMix): AudioDemo {
  const context = new AudioContext({ sampleRate });
  const master = context.createGain();
  const music = context.createGain();
  const effects = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  music.connect(master);
  effects.connect(master);
  master.connect(analyser);
  analyser.connect(context.destination);

  for (const frequency of [220, 277.18, 329.63]) {
    const tone = context.createOscillator();
    tone.frequency.value = frequency;
    const level = context.createGain();
    level.gain.value = 0.08;
    tone.connect(level).connect(music);
    tone.start();
  }

  // Square LFO gates a beep on and off twice per second.
  const beep = context.createOscillator();
  beep.type = 'triangle';
  beep.frequency.value = 880;
  const gate = context.createGain();
  gate.gain.value = 0.1;
  const lfo = context.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 2;
  const depth = context.createGain();
  depth.gain.value = 0.1;
  lfo.connect(depth).connect(gate.gain);
  beep.connect(gate).connect(effects);
  beep.start();
  lfo.start();

  const frame = new Float32Array(analyser.fftSize);
  const demo: AudioDemo = {
    sampleRate: context.sampleRate,
    setMix(next) {
      master.gain.value = next.master;
      music.gain.value = next.music;
      effects.gain.value = next.effects;
    },
    gains: () => ({ master: master.gain.value, music: music.gain.value, effects: effects.gain.value }),
    level() {
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const sample of frame) sum += sample * sample;
      return Math.sqrt(sum / frame.length);
    },
    close: () => context.close(),
  };
  demo.setMix(mix);
  return demo;
}
