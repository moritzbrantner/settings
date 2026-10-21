// Live Web Audio demo for the Audio category. Volume and mute arrive from the staged session state,
// so edits are heard at once and Cancel restores the committed mix; the sample rate is a restart
// setting and only applies when playback (re)starts with the launch value.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@moritzbrantner/ui/stable';
import { createAudioDemo, type AudioDemo, type AudioMix } from './audio';

export function AudioPreview({ mix, sampleRate }: { mix: AudioMix; sampleRate: number }) {
  const demoRef = useRef<AudioDemo | null>(null);
  const [demo, setDemo] = useState<AudioDemo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [gains, setGains] = useState<ReturnType<AudioDemo['gains']> | null>(null);
  const supported = typeof AudioContext === 'function';

  useEffect(() => {
    if (!demo) return;
    demo.setMix(mix);
    // Read back what the audio graph now holds rather than echoing the requested mix.
    setGains(demo.gains());
  }, [demo, mix]);

  useEffect(() => {
    if (!demo) return;
    let frame = requestAnimationFrame(function tick() {
      setLevel(demo.level());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [demo]);

  useEffect(() => () => void demoRef.current?.close(), []);

  function toggle() {
    if (demo) {
      void demo.close();
      demoRef.current = null;
      setDemo(null);
      setGains(null);
      setLevel(0);
      return;
    }
    try {
      const created = createAudioDemo(sampleRate, mix);
      demoRef.current = created;
      setDemo(created);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <figure
      data-audio-preview=""
      data-playing={String(demo !== null)}
      data-muted={String(mix.muted)}
      data-master-gain={gains ? String(gains.master) : undefined}
      data-music-gain={gains ? String(gains.music) : undefined}
      data-effects-gain={gains ? String(gains.effects) : undefined}
      data-sample-rate={demo ? String(demo.sampleRate) : undefined}
      className="grid w-full max-w-2xl min-w-0 gap-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={!supported} onClick={toggle}>
          {demo ? 'Stop demo audio' : 'Play demo audio'}
        </Button>
        <div
          role="meter"
          aria-label="Output level"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(level.toFixed(3))}
          className="h-2 min-w-24 flex-1 overflow-hidden rounded bg-background"
        >
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, level * 400)}%` }} />
        </div>
      </div>
      {!supported && (
        <p className="text-sm text-muted-foreground">Audio preview unavailable: this browser has no Web Audio API.</p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          Audio playback failed: {error}
        </p>
      )}
      <figcaption className="text-xs text-muted-foreground">
        Generated chord (music) and beep (effects) through Web Audio at {demo?.sampleRate ?? sampleRate} Hz.
        Volume edits are heard at once; Apply keeps them, Cancel restores the previous mix. Output-device
        selection is not supported.
      </figcaption>
    </figure>
  );
}
