'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'eurojury_reveal_muted';

/**
 * Read the current muted preference. Used by the reveal stage to decide
 * whether to play() the audio elements. Exported as a tiny hook so the
 * RevealStage can react when the user toggles mid-reveal.
 */
export function useRevealMuted(): {
  muted: boolean;
  setMuted: (m: boolean) => void;
} {
  const [muted, setMutedState] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === '1') setMutedState(true);
    } catch {
      /* ignore */
    }
  }, []);
  const setMuted = (m: boolean) => {
    setMutedState(m);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  };
  return { muted, setMuted };
}

export function MuteToggle({
  muted,
  onChange,
}: {
  muted: boolean;
  onChange: (m: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!muted)}
      aria-label={muted ? 'Unmute' : 'Mute'}
      className="fixed right-4 top-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/70 text-xl shadow-lg backdrop-blur hover:bg-card/90"
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
