'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import type { Database } from '@eurojury/db/types';

type EventTimelineRow = Database['public']['Tables']['event_timeline']['Row'];

/**
 * Subscribe to event_timeline rows for a party.
 * Returns sorted-by-idx (deterministic, regardless of DB row order).
 * Refetches in full on any INSERT/UPDATE/DELETE to keep this simple — the
 * timeline is small (~30 rows) and changes only when the host imports JSON.
 */
export function useEventTimeline(partyId: string): {
  timeline: EventTimelineRow[];
  isLoading: boolean;
} {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [timeline, setTimeline] = useState<EventTimelineRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;

    const fetchAll = async () => {
      const { data } = await supabase
        .from('event_timeline')
        .select('*')
        .eq('party_id', partyId)
        .order('idx', { ascending: true });
      if (cancelled) return;
      setTimeline(data ?? []);
      setIsLoading(false);
    };

    fetchAll();

    const chan = supabase
      .channel(`event_timeline:${partyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_timeline',
          filter: `party_id=eq.${partyId}`,
        },
        () => {
          fetchAll();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId]);

  return { timeline, isLoading };
}
