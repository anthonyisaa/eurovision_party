'use client';

import { useEffect, useMemo, useState } from 'react';
import { deriveEvent, type DeriveEventOutput } from '@eurojury/shared';
import { useParty } from './use-party';
import { useEventTimeline } from './use-event-timeline';

/**
 * High-level hook for /live and /tv. Combines `useParty` + `useEventTimeline`
 * through the pure `deriveEvent` function.
 *
 * When `fake_broadcast` is on, effectiveSeconds is wall-clock-derived and
 * must advance even when no DB rows change — so we tick a 1s timer in that
 * mode. Otherwise we only re-evaluate when realtime fires.
 */
export function useCurrentEvent(partyId: string): DeriveEventOutput {
  const { party } = useParty(partyId);
  const { timeline } = useEventTimeline(partyId);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Tick once per second while fake_broadcast is on. The tick is what makes
  // the current event change as wall-clock time advances. No-op (and no
  // interval allocated) when fake_broadcast is off.
  useEffect(() => {
    if (!party?.fake_broadcast) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [party?.fake_broadcast]);

  return useMemo(() => {
    if (!party) {
      return {
        current: null,
        effectiveSeconds: 0,
        effectivePaused: false,
        sourceOfTruth: 'none' as const,
      };
    }
    return deriveEvent({ party, timeline, nowMs });
  }, [party, timeline, nowMs]);
}
