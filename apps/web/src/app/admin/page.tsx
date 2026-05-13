'use client';

// /admin — host control panel. Mobile-first vertical stack of big-touch sections.
//
// Auth gate: every section calls a server action that re-checks host status on
// the server. The UI also hides controls when the current guest cookie doesn't
// match parties.host_guest_id, but that's UX, not security.
//
// Realtime: party row + side_bets + guests + votes counts. Reactions count is
// derived from a separate count query refreshed on each `reactions` event.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { getPartyId } from '@/lib/party-id';
import {
  claimHostRole,
  setPhase,
  setPaused,
  setManualEventIdx,
  resolveSideBet,
  advanceReveal,
  setFakeBroadcast,
  tickFakeBroadcast,
  type Phase,
} from '../actions/admin';
import type { Database } from '@eurojury/db/types';

type PartyRow = Database['public']['Tables']['parties']['Row'];
type EventRow = Database['public']['Tables']['event_timeline']['Row'];
type SideBet = Database['public']['Tables']['side_bets']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];

const PHASES: Phase[] = ['lobby', 'live', 'voting', 'reveal', 'closed'];

export default function AdminPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const partyId = useMemo(() => {
    try {
      return getPartyId();
    } catch {
      return '';
    }
  }, []);

  const [guestId, setGuestId] = useState<string | null>(null);
  const [party, setParty] = useState<PartyRow | null>(null);
  const [timeline, setTimeline] = useState<EventRow[]>([]);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [hostGuest, setHostGuest] = useState<Guest | null>(null);
  const [stats, setStats] = useState({ guests: 0, voters: 0, reactions: 0 });
  const [loaded, setLoaded] = useState(false);

  // Bootstrap.
  useEffect(() => {
    setGuestId(getGuestIdClient());
    if (!partyId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const partyRes = await supabase
        .from('parties')
        .select('*')
        .eq('id', partyId)
        .single();
      const timelineRes = await supabase
        .from('event_timeline')
        .select('*')
        .eq('party_id', partyId)
        .order('idx', { ascending: true });
      const betsRes = await supabase
        .from('side_bets')
        .select('*')
        .eq('party_id', partyId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (partyRes.data) setParty(partyRes.data);
      setTimeline(timelineRes.data ?? []);
      setSideBets(betsRes.data ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, partyId]);

  // Load host guest name when host_guest_id is set.
  useEffect(() => {
    const hid = party?.host_guest_id;
    if (!hid) {
      setHostGuest(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('guests')
      .select('*')
      .eq('id', hid)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHostGuest(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, party?.host_guest_id]);

  // Stats refresh — fetches three counts. Called on mount and on each
  // realtime event for the relevant tables.
  const refreshStats = useCallback(async () => {
    if (!partyId) return;
    const [guestsRes, votesRes, reactionsRes] = await Promise.all([
      supabase
        .from('guests')
        .select('id', { count: 'exact', head: true })
        .eq('party_id', partyId),
      supabase
        .from('votes')
        .select('guest_id', { count: 'exact' })
        .in(
          'guest_id',
          (
            await supabase.from('guests').select('id').eq('party_id', partyId)
          ).data?.map((g) => g.id) ?? [],
        ),
      supabase
        .from('reactions')
        .select('guest_id', { count: 'exact', head: true })
        .in(
          'guest_id',
          (
            await supabase.from('guests').select('id').eq('party_id', partyId)
          ).data?.map((g) => g.id) ?? [],
        ),
    ]);
    const distinctVoters = new Set(
      (votesRes.data ?? []).map((v) => v.guest_id),
    ).size;
    setStats({
      guests: guestsRes.count ?? 0,
      voters: distinctVoters,
      reactions: reactionsRes.count ?? 0,
    });
  }, [supabase, partyId]);

  useEffect(() => {
    if (!partyId) return;
    refreshStats();
  }, [partyId, refreshStats]);

  // Realtime subscriptions.
  useEffect(() => {
    if (!partyId) return;
    const chan = supabase
      .channel(`admin:${partyId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` },
        (payload) => setParty(payload.new as PartyRow),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_timeline', filter: `party_id=eq.${partyId}` },
        () => {
          supabase
            .from('event_timeline')
            .select('*')
            .eq('party_id', partyId)
            .order('idx', { ascending: true })
            .then(({ data }) => setTimeline(data ?? []));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'side_bets', filter: `party_id=eq.${partyId}` },
        (payload) => {
          setSideBets((prev) => {
            const row = payload.new as SideBet | null;
            const old = payload.old as SideBet | null;
            if (payload.eventType === 'DELETE' && old) {
              return prev.filter((b) => b.id !== old.id);
            }
            if (row) {
              const idx = prev.findIndex((b) => b.id === row.id);
              const next = [...prev];
              if (idx >= 0) next[idx] = row;
              else next.push(row);
              return next;
            }
            return prev;
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guests', filter: `party_id=eq.${partyId}` },
        () => refreshStats(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes' },
        () => refreshStats(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reactions' },
        () => refreshStats(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, [supabase, partyId, refreshStats]);

  if (!partyId) {
    return (
      <main className="mx-auto w-full max-w-md p-6 text-center">
        <p className="text-sm text-destructive">
          NEXT_PUBLIC_PARTY_ID is not configured.
        </p>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }
  if (!guestId) {
    return (
      <main className="mx-auto w-full max-w-md space-y-3 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Visit / first</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have a guest cookie yet. Go to the landing page
              first and join the party — that issues your guest_id, which is
              required before you can claim the host role.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (!party) {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <p className="text-sm text-destructive">Party not found.</p>
      </main>
    );
  }

  const claimable = party.host_guest_id == null;
  const isHost = party.host_guest_id === guestId;
  const otherHost = party.host_guest_id != null && !isHost;

  return (
    <main className="mx-auto w-full max-w-md space-y-4 px-4 py-6 pb-32">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Host console
        </p>
        <h1 className="bg-gradient-to-br from-eurorose-400 via-eurogold-400 to-europurp-500 bg-clip-text text-3xl font-black tracking-tight text-transparent">
          Admin
        </h1>
      </header>

      {claimable && (
        <ClaimHostCard
          partyId={partyId}
          guestId={guestId}
          onClaimed={(newHostId) =>
            setParty((p) => (p ? { ...p, host_guest_id: newHostId } : p))
          }
        />
      )}

      {otherHost && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardHeader>
            <CardTitle>You&apos;re not the host</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Current host:{' '}
              <span className="font-semibold">
                {hostGuest?.display_name ?? '(unknown)'}
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Only the host can change the show state.
            </p>
          </CardContent>
        </Card>
      )}

      {isHost && (
        <>
          <PauseSection party={party} partyId={partyId} guestId={guestId} />
          <PhaseSection party={party} partyId={partyId} guestId={guestId} />
          <ForceEventSection
            party={party}
            partyId={partyId}
            guestId={guestId}
            timeline={timeline}
          />
          <FakeBroadcastSection
            party={party}
            partyId={partyId}
            guestId={guestId}
          />
          <SideBetsSection
            partyId={partyId}
            guestId={guestId}
            bets={sideBets}
          />
          {party.phase === 'reveal' && (
            <RevealSection party={party} partyId={partyId} guestId={guestId} />
          )}
          <StatsSection stats={stats} />
        </>
      )}
    </main>
  );
}

// --- claim host ------------------------------------------------------

function ClaimHostCard({
  partyId,
  guestId,
  onClaimed,
}: {
  partyId: string;
  guestId: string;
  onClaimed: (hostId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      const res = await claimHostRole(partyId, guestId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.is_host) {
        toast.success('You are now the host');
        onClaimed(guestId);
      } else {
        toast.error('Someone else already claimed the host role');
        if (res.data.host_guest_id) onClaimed(res.data.host_guest_id);
      }
    });
  };
  return (
    <Card className="border-eurogold-500/40 bg-eurogold-500/10">
      <CardHeader>
        <CardTitle>Claim host role</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No host yet. First to claim takes control of the show.
        </p>
        <Button
          onClick={onClick}
          disabled={pending}
          className="h-14 w-full text-base font-bold"
        >
          {pending ? 'Claiming…' : 'Claim host role'}
        </Button>
      </CardContent>
    </Card>
  );
}

// --- pause -----------------------------------------------------------

function PauseSection({
  party,
  partyId,
  guestId,
}: {
  party: PartyRow;
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState(party.party_pause_reason ?? '');
  const [showReasonInput, setShowReasonInput] = useState(false);

  const onToggle = () => {
    if (!party.party_paused) {
      // About to pause — show reason input first.
      setShowReasonInput(true);
      return;
    }
    // Currently paused — resume directly.
    startTransition(async () => {
      const res = await setPaused(partyId, guestId, false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Resumed');
    });
  };

  const confirmPause = () => {
    startTransition(async () => {
      const res = await setPaused(partyId, guestId, true, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Paused');
      setShowReasonInput(false);
    });
  };

  return (
    <Card className="sticky top-2 z-10 border-eurorose-500/40 bg-card/95 backdrop-blur">
      <CardContent className="space-y-3 p-4">
        {!showReasonInput ? (
          <Button
            onClick={onToggle}
            disabled={pending}
            className={`h-16 w-full text-lg font-bold ${
              party.party_paused
                ? 'bg-eurogold-500 text-black hover:bg-eurogold-400'
                : 'bg-eurorose-500 hover:bg-eurorose-600'
            }`}
          >
            {party.party_paused ? '▶️ Resume' : '⏸️ Pause'}
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Pause reason (optional)</p>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. snack break"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                onClick={confirmPause}
                disabled={pending}
                className="h-12 flex-1 bg-eurorose-500 text-base font-bold hover:bg-eurorose-600"
              >
                Confirm pause
              </Button>
              <Button
                onClick={() => setShowReasonInput(false)}
                disabled={pending}
                variant="secondary"
                className="h-12"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {party.party_paused && party.party_pause_reason && (
          <p className="text-center text-xs text-muted-foreground">
            Reason: {party.party_pause_reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- phase -----------------------------------------------------------

function PhaseSection({
  party,
  partyId,
  guestId,
}: {
  party: PartyRow;
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmTarget, setConfirmTarget] = useState<Phase | null>(null);
  const currentIdx = PHASES.indexOf(party.phase as Phase);

  const move = (target: Phase) => {
    startTransition(async () => {
      const res = await setPhase(partyId, guestId, target);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Phase → ${target}`);
      setConfirmTarget(null);
    });
  };

  const onTap = (target: Phase, targetIdx: number) => {
    if (targetIdx < currentIdx) {
      setConfirmTarget(target);
      return;
    }
    move(target);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phase</CardTitle>
        <p className="text-xs uppercase tracking-widest text-eurogold-400">
          {party.phase}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {PHASES.map((p, i) => {
            const active = p === party.phase;
            const isBack = i < currentIdx;
            return (
              <Button
                key={p}
                onClick={() => onTap(p, i)}
                disabled={pending || active}
                variant={active ? 'default' : isBack ? 'outline' : 'secondary'}
                className="h-12 capitalize"
              >
                {active ? `✓ ${p}` : p}
              </Button>
            );
          })}
        </div>

        {confirmTarget && (
          <ConfirmDialog
            open={!!confirmTarget}
            title="Move backwards?"
            body={`Going back to ${confirmTarget} may reset progress. Continue?`}
            confirmLabel={`Move to ${confirmTarget}`}
            onConfirm={() => move(confirmTarget)}
            onCancel={() => setConfirmTarget(null)}
            pending={pending}
          />
        )}
      </CardContent>
    </Card>
  );
}

// --- force event ----------------------------------------------------

function ForceEventSection({
  party,
  partyId,
  guestId,
  timeline,
}: {
  party: PartyRow;
  partyId: string;
  guestId: string;
  timeline: EventRow[];
}) {
  const [pending, startTransition] = useTransition();
  const onChange = (raw: string) => {
    const idx = raw === '' ? null : Number(raw);
    startTransition(async () => {
      const res = await setManualEventIdx(partyId, guestId, idx);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(idx == null ? 'Cleared override' : `Forced event ${idx}`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Force current event</CardTitle>
        <p className="text-xs text-muted-foreground">
          Override yt-time-based derivation. Useful when YouTube drifts.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <select
          value={party.manual_event_idx ?? ''}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">— no override —</option>
          {timeline.map((r) => (
            <option key={r.idx} value={r.idx}>
              [{r.idx}] {r.category} · {r.description}
            </option>
          ))}
        </select>
        <Button
          onClick={() => onChange('')}
          disabled={pending || party.manual_event_idx == null}
          variant="outline"
          className="w-full"
        >
          Clear override
        </Button>
      </CardContent>
    </Card>
  );
}

// --- fake broadcast ------------------------------------------------

function FakeBroadcastSection({
  party,
  partyId,
  guestId,
}: {
  party: PartyRow;
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const startRef = useRef<number | null>(null);
  const startSecondsRef = useRef<number>(0);

  // Run the ticker whenever fake_broadcast is true. We bind the start time
  // to the moment we (re)mount with fake_broadcast=true; ticks compute
  // elapsedSeconds = (now - start)/1000 + startSeconds. We pass the result
  // to tickFakeBroadcast which updates parties.yt_current_seconds.
  useEffect(() => {
    if (!party.fake_broadcast) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    startSecondsRef.current = party.yt_current_seconds ?? 0;
    const id = setInterval(() => {
      if (startRef.current == null) return;
      const elapsed = (Date.now() - startRef.current) / 1000 + startSecondsRef.current;
      tickFakeBroadcast(partyId, guestId, elapsed).catch(() => {
        /* swallow — admin page tolerates transient errors */
      });
    }, 2000);
    return () => {
      clearInterval(id);
    };
    // Intentionally only re-bind when fake_broadcast flips so we don't reset
    // start time on every party row update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.fake_broadcast, partyId, guestId]);

  const onToggle = () => {
    const target = !party.fake_broadcast;
    startTransition(async () => {
      const res = await setFakeBroadcast(partyId, guestId, target);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(target ? 'Fake broadcast ON' : 'Fake broadcast OFF');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fake broadcast</CardTitle>
        <p className="text-xs text-muted-foreground">
          When YouTube isn&apos;t available, simulate playback by advancing
          yt_current_seconds at real-time every 2s while /admin is open.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          onClick={onToggle}
          disabled={pending}
          variant={party.fake_broadcast ? 'destructive' : 'default'}
          className="h-12 w-full"
        >
          {party.fake_broadcast ? 'Stop fake broadcast' : 'Start fake broadcast'}
        </Button>
        {party.fake_broadcast && (
          <p className="text-center text-xs text-eurogold-400">
            ▶ Ticking · yt_current_seconds ={' '}
            {Math.floor(party.yt_current_seconds ?? 0)}s
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- side bets ----------------------------------------------------

interface OptionsJson {
  kind?: 'country';
  options?: string[];
}

function SideBetsSection({
  partyId,
  guestId,
  bets,
}: {
  partyId: string;
  guestId: string;
  bets: SideBet[];
}) {
  if (bets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Side bets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No side bets yet. Create some in <code>/admin/setup</code>.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Side bets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {bets.map((bet) => (
          <SideBetResolveRow
            key={bet.id}
            bet={bet}
            partyId={partyId}
            guestId={guestId}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SideBetResolveRow({
  bet,
  partyId,
  guestId,
}: {
  bet: SideBet;
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState('');

  const opts = (bet.options_json ?? {}) as OptionsJson;
  const isCountry = opts.kind === 'country';
  const optionList = isCountry
    ? []
    : Array.isArray(opts.options)
      ? opts.options
      : [];
  const resolved = bet.resolved_value != null;

  const onResolve = () => {
    const value = isCountry ? pick.trim().toUpperCase() : pick;
    if (!value) {
      toast.error('Pick a value first');
      return;
    }
    startTransition(async () => {
      const res = await resolveSideBet(partyId, guestId, bet.id, value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Resolved');
    });
  };

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-secondary/20 p-3">
      <p className="text-sm font-semibold">{bet.question}</p>
      {resolved ? (
        <div className="inline-flex rounded-full bg-eurogold-500/20 px-2 py-0.5 text-xs font-semibold text-eurogold-400">
          ✓ {bet.resolved_value}
        </div>
      ) : (
        <>
          {isCountry ? (
            <Input
              placeholder="Country code (e.g. SE)"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={pending}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {optionList.map((o) => (
                <button
                  key={o}
                  onClick={() => setPick(o)}
                  disabled={pending}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    pick === o
                      ? 'border-eurorose-400 bg-eurorose-500/30 text-eurorose-300'
                      : 'border-border/60 bg-background/40'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <Button
            onClick={onResolve}
            disabled={pending || !pick}
            className="h-10 w-full"
          >
            Resolve
          </Button>
        </>
      )}
    </div>
  );
}

// --- reveal step --------------------------------------------------

function RevealSection({
  party,
  partyId,
  guestId,
}: {
  party: PartyRow;
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmBack, setConfirmBack] = useState(false);

  const advance = (delta: 1 | -1) => {
    startTransition(async () => {
      const res = await advanceReveal(partyId, guestId, delta);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Reveal step → ${res.data.reveal_step}`);
      setConfirmBack(false);
    });
  };

  return (
    <Card className="border-eurogold-500/40">
      <CardHeader>
        <CardTitle>Reveal step</CardTitle>
        <p className="text-xs uppercase tracking-widest text-eurogold-400">
          step {party.reveal_step} / 10
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          onClick={() => advance(1)}
          disabled={pending || party.reveal_step >= 10}
          className="h-14 w-full text-lg font-bold"
        >
          Next step ▶
        </Button>
        <Button
          onClick={() => setConfirmBack(true)}
          disabled={pending || party.reveal_step <= 0}
          variant="outline"
          className="h-10 w-full"
        >
          ◀ Back
        </Button>
        {confirmBack && (
          <ConfirmDialog
            open={confirmBack}
            title="Step back?"
            body="Stepping back may de-sync the audience. Continue?"
            confirmLabel="Step back"
            onConfirm={() => advance(-1)}
            onCancel={() => setConfirmBack(false)}
            pending={pending}
          />
        )}
      </CardContent>
    </Card>
  );
}

// --- stats --------------------------------------------------------

function StatsSection({ stats }: { stats: { guests: number; voters: number; reactions: number } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Party stats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Guests" value={stats.guests} />
          <Stat label="Voters" value={stats.voters} />
          <Stat label="Reactions" value={stats.reactions} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-secondary/30 p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// --- minimal confirm dialog --------------------------------------

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
      >
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={onConfirm}
            disabled={pending}
            variant="destructive"
            className="h-12 flex-1"
          >
            {confirmLabel}
          </Button>
          <Button
            onClick={onCancel}
            disabled={pending}
            variant="secondary"
            className="h-12"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
