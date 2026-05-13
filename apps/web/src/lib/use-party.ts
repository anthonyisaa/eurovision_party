'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import type { Database } from '@eurojury/db/types';

type Party = Database['public']['Tables']['parties']['Row'];

/**
 * Subscribe to a parties row by id.
 * - Fetches once on mount.
 * - Listens for UPDATEs and replaces local state with `payload.new`.
 * - Unsubscribes on cleanup.
 *
 * Used by /live (phone) and /tv (Electron overlay) — anywhere that needs to
 * react to host-side state changes (phase, paused, manual_event_idx,
 * yt_current_seconds, fake_broadcast_*).
 */
export function useParty(partyId: string): {
  party: Party | null;
  isLoading: boolean;
  error: string | null;
} {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [party, setParty] = useState<Party | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from('parties')
        .select('*')
        .eq('id', partyId)
        .single();
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else {
        setParty(data as Party);
      }
      setIsLoading(false);
    })();

    const chan = supabase
      .channel(`party:${partyId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'parties',
          filter: `id=eq.${partyId}`,
        },
        (payload) => {
          setParty(payload.new as Party);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId]);

  return { party, isLoading, error };
}
