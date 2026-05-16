'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { submitPredictions } from '../actions/predictions';
import { submitSideBetPick } from '../actions/side-bets';
import type { Database } from '@eurojury/db/types';

type Country = Database['public']['Tables']['countries']['Row'];
type Guest = Database['public']['Tables']['guests']['Row'];
type SideBet = Database['public']['Tables']['side_bets']['Row'];
type SideBetPickRow = Database['public']['Tables']['side_bet_picks']['Row'];
type Prediction = Database['public']['Tables']['predictions']['Row'];

interface PartyRow {
  id: string;
  phase: string;
}

const PARTY_ID = process.env.NEXT_PUBLIC_PARTY_ID!;

// Lobby — four stacked sections on phone: your team card, roster, predictions, side bets.
// All data realtime-subscribed; predictions/side-bets lock when phase != 'lobby'.
export default function LobbyPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [me, setMe] = useState<Guest | null>(null);
  const [allGuests, setAllGuests] = useState<Guest[]>([]);
  const [countriesByCode, setCountriesByCode] = useState<Record<string, Country>>({});
  const [party, setParty] = useState<PartyRow | null>(null);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [myPicks, setMyPicks] = useState<Record<string, string>>({});
  const [myPredictions, setMyPredictions] = useState<Prediction[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Bootstrap: pull guest id from cookie + initial DB reads.
  useEffect(() => {
    const gid = getGuestIdClient();
    setGuestId(gid);

    let cancelled = false;
    (async () => {
      // Sequential awaits keep Supabase's row-type inference happy
      // (Promise.all with mixed return shapes collapses to `never`). The
      // lobby load is small enough that serial requests are fine.
      const countriesRes = await supabase.from('countries').select('*');
      const guestsRes = await supabase
        .from('guests')
        .select('*')
        .eq('party_id', PARTY_ID);
      const partyRes = await supabase
        .from('parties')
        .select('id, phase')
        .eq('id', PARTY_ID)
        .single();
      const betsRes = await supabase
        .from('side_bets')
        .select('*')
        .eq('party_id', PARTY_ID);
      if (cancelled) return;
      const byCode: Record<string, Country> = {};
      for (const c of countriesRes.data ?? []) byCode[c.code] = c;
      setCountriesByCode(byCode);
      setAllGuests(guestsRes.data ?? []);
      setMe((guestsRes.data ?? []).find((g) => g.id === gid) ?? null);
      if (partyRes.data) setParty(partyRes.data);
      setSideBets(betsRes.data ?? []);

      if (gid) {
        const picksRes = await supabase
          .from('side_bet_picks')
          .select('*')
          .eq('guest_id', gid);
        const predsRes = await supabase
          .from('predictions')
          .select('*')
          .eq('guest_id', gid);
        const pickMap: Record<string, string> = {};
        for (const p of picksRes.data ?? []) {
          pickMap[p.bet_id] = p.pick;
        }
        setMyPicks(pickMap);
        setMyPredictions(predsRes.data ?? []);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // If no guest cookie or no row in DB after load, bounce to /.
  useEffect(() => {
    if (loaded && (!guestId || !me)) {
      router.replace('/');
    }
  }, [loaded, guestId, me, router]);

  // Realtime: guests, parties (phase), side_bets.
  useEffect(() => {
    const chan = supabase
      .channel(`lobby:${PARTY_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guests', filter: `party_id=eq.${PARTY_ID}` },
        (payload) => {
          setAllGuests((prev) => {
            const next = [...prev];
            const row = payload.new as Guest | null;
            const old = payload.old as Guest | null;
            if (payload.eventType === 'DELETE' && old) {
              return next.filter((g) => g.id !== old.id);
            }
            if (row) {
              const idx = next.findIndex((g) => g.id === row.id);
              if (idx >= 0) next[idx] = row;
              else next.push(row);
            }
            return next;
          });
          const row = payload.new as Guest | null;
          if (row && row.id === guestId) setMe(row);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${PARTY_ID}` },
        (payload) => {
          const row = payload.new as { id: string; phase: string };
          setParty({ id: row.id, phase: row.phase });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'side_bets', filter: `party_id=eq.${PARTY_ID}` },
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
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, [supabase, guestId]);

  const phase = party?.phase ?? 'lobby';
  const lobbyLocked = phase !== 'lobby';

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!me || !guestId) return null;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
      <header className="space-y-4">
        <div className="flex justify-center pt-2">
          <Image
            src="/eurovision-2026-logo.png"
            alt="Eurovision Song Contest 2026"
            width={300}
            height={130}
            priority
            className="brand-mark h-auto w-full max-w-[260px]"
          />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Hey {me.display_name}
          </p>
          <p className="text-xs uppercase tracking-[0.3em] text-eurorose-400">
            Vienna · United by Music
          </p>
          {lobbyLocked ? (
            <p className="pt-1 text-sm text-eurogold-400">
              Show&apos;s in progress — predictions locked. Head to your TV.
            </p>
          ) : null}
        </div>
      </header>

      <TeamCard me={me} countriesByCode={countriesByCode} />
      <RosterCard guests={allGuests} countriesByCode={countriesByCode} meId={me.id} />
      <PredictionsCard
        me={me}
        countriesByCode={countriesByCode}
        myPredictions={myPredictions}
        onSaved={setMyPredictions}
        locked={lobbyLocked}
      />
      <SideBetsCard
        bets={sideBets}
        countriesByCode={countriesByCode}
        myPicks={myPicks}
        guestId={guestId}
        onPicked={(betId, value) =>
          setMyPicks((prev) => ({ ...prev, [betId]: value }))
        }
      />

      <div className="pt-2 text-center">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => router.push('/live')}
        >
          Go to live view
        </Button>
      </div>
    </main>
  );
}

// --- Sub-components --------------------------------------------------

function TeamCard({
  me,
  countriesByCode,
}: {
  me: Guest;
  countriesByCode: Record<string, Country>;
}) {
  const codes = [me.assigned_country_1, me.assigned_country_2].filter(
    (c): c is string => Boolean(c),
  );
  return (
    <Card className="border-eurogold-500/40 bg-card/70 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Your team</span>
          <span className="text-xs font-normal text-muted-foreground">
            (you can&apos;t vote for these)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No countries yet.</p>
        ) : (
          codes.map((code) => {
            const c = countriesByCode[code];
            if (!c) return null;
            return (
              <div
                key={code}
                className="flex gap-3 rounded-lg border border-border/60 bg-secondary/40 p-3"
              >
                <div className="text-5xl leading-none">{c.flag_emoji}</div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-semibold">{c.name}</p>
                  {(c.artist || c.song_title) && (
                    <p className="truncate text-sm text-muted-foreground">
                      {[c.artist, c.song_title].filter(Boolean).join(' — ')}
                    </p>
                  )}
                  {c.vibe_blurb && (
                    <p className="text-xs italic text-eurorose-300">
                      {c.vibe_blurb}
                    </p>
                  )}
                  <div className="flex gap-3 pt-1 text-xs">
                    {c.spotify_url && (
                      <a
                        href={c.spotify_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-eurogold-400 underline"
                      >
                        Spotify
                      </a>
                    )}
                    {c.youtube_url && (
                      <a
                        href={c.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-eurogold-400 underline"
                      >
                        YouTube
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function RosterCard({
  guests,
  countriesByCode,
  meId,
}: {
  guests: Guest[];
  countriesByCode: Record<string, Country>;
  meId: string;
}) {
  const sorted = [...guests].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return (
    <Card className="border-europurp-700/40 bg-card/70 backdrop-blur">
      <CardHeader>
        <CardTitle>The jury ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {sorted.map((g) => {
            const f1 = g.assigned_country_1 ? countriesByCode[g.assigned_country_1]?.flag_emoji : '';
            const f2 = g.assigned_country_2 ? countriesByCode[g.assigned_country_2]?.flag_emoji : '';
            return (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2 text-sm"
              >
                <span className="truncate">
                  {g.display_name}
                  {g.id === meId && (
                    <span className="ml-2 text-xs text-eurogold-400">(you)</span>
                  )}
                </span>
                <span className="text-2xl leading-none">{f1}{f2}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function PredictionsCard({
  me,
  countriesByCode,
  myPredictions,
  onSaved,
  locked,
}: {
  me: Guest;
  countriesByCode: Record<string, Country>;
  myPredictions: Prediction[];
  onSaved: (p: Prediction[]) => void;
  locked: boolean;
}) {
  const initial: Record<1 | 2 | 3, string> = { 1: '', 2: '', 3: '' };
  for (const p of myPredictions) {
    if (p.position === 1 || p.position === 2 || p.position === 3) {
      initial[p.position as 1 | 2 | 3] = p.country_code;
    }
  }
  const [picks, setPicks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const own = new Set(
    [me.assigned_country_1, me.assigned_country_2].filter((c): c is string => Boolean(c)),
  );
  const candidates = Object.values(countriesByCode)
    .filter((c) => !own.has(c.code))
    .sort((a, b) => a.name.localeCompare(b.name));

  const onSave = () => {
    if (locked) return;
    if (!picks[1] || !picks[2] || !picks[3]) {
      setError('Pick all three positions');
      return;
    }
    if (new Set([picks[1], picks[2], picks[3]]).size !== 3) {
      setError('Three distinct countries');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitPredictions(me.id, picks);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved([1, 2, 3].map((pos) => ({
        guest_id: me.id,
        position: pos,
        country_code: picks[pos as 1 | 2 | 3],
        cast_at: new Date().toISOString(),
      })));
      setSavedAt(Date.now());
    });
  };

  const slotLabel: Record<1 | 2 | 3, string> = { 1: '🥇 1st', 2: '🥈 2nd', 3: '🥉 3rd' };

  return (
    <Card className="border-europurp-700/40 bg-card/70 backdrop-blur">
      <CardHeader>
        <CardTitle>Predictions</CardTitle>
        <p className="text-xs text-muted-foreground">
          Top 3 finishers. 5 pts for exact match, 2 for in-top-3 wrong spot.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {([1, 2, 3] as const).map((pos) => (
          <div key={pos} className="flex items-center gap-3">
            <span className="w-14 text-sm font-semibold">{slotLabel[pos]}</span>
            <select
              value={picks[pos]}
              disabled={locked || pending}
              onChange={(e) =>
                setPicks((p) => ({ ...p, [pos]: e.target.value }))
              }
              className="h-10 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">—</option>
              {candidates.map((c) => {
                // can't pick same country in multiple slots
                const usedElsewhere = Object.entries(picks).some(
                  ([k, v]) => Number(k) !== pos && v === c.code,
                );
                return (
                  <option key={c.code} value={c.code} disabled={usedElsewhere}>
                    {c.flag_emoji} {c.name}
                  </option>
                );
              })}
            </select>
          </div>
        ))}
        <Button
          onClick={onSave}
          disabled={locked || pending}
          className="w-full"
        >
          {locked ? 'Locked' : pending ? 'Saving…' : 'Save predictions'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {savedAt && !error && (
          <p className="text-sm text-eurogold-400">Saved ✓</p>
        )}
      </CardContent>
    </Card>
  );
}

function SideBetsCard({
  bets,
  countriesByCode,
  myPicks,
  guestId,
  onPicked,
}: {
  bets: SideBet[];
  countriesByCode: Record<string, Country>;
  myPicks: Record<string, string>;
  guestId: string;
  onPicked: (betId: string, value: string) => void;
}) {
  if (bets.length === 0) {
    return (
      <Card className="border-europurp-700/40 bg-card/70 backdrop-blur">
        <CardHeader>
          <CardTitle>Side bets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No side bets yet. Host hasn&apos;t added any.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-europurp-700/40 bg-card/70 backdrop-blur">
      <CardHeader>
        <CardTitle>Side bets</CardTitle>
        <p className="text-xs text-muted-foreground">1 pt per correct call.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {bets.map((bet) => (
          <SideBetRow
            key={bet.id}
            bet={bet}
            countriesByCode={countriesByCode}
            currentPick={myPicks[bet.id] ?? ''}
            guestId={guestId}
            onPicked={onPicked}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface OptionsJson {
  kind?: 'country';
  options?: string[];
}

function SideBetRow({
  bet,
  countriesByCode,
  currentPick,
  guestId,
  onPicked,
}: {
  bet: SideBet;
  countriesByCode: Record<string, Country>;
  currentPick: string;
  guestId: string;
  onPicked: (betId: string, value: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resolved = bet.resolved_value != null;

  // options_json supports either {kind: 'country'} (any country code) or {options: [...]}.
  const opts = (bet.options_json ?? {}) as OptionsJson;
  let optionList: Array<{ value: string; label: string }> = [];
  if (opts.kind === 'country') {
    optionList = Object.values(countriesByCode)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.code, label: `${c.flag_emoji} ${c.name}` }));
  } else if (Array.isArray(opts.options)) {
    optionList = opts.options.map((o) => ({ value: o, label: o }));
  }

  const submit = (value: string) => {
    setError(null);
    startTransition(async () => {
      const res = await submitSideBetPick(bet.id, guestId, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onPicked(bet.id, value);
    });
  };

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-secondary/20 p-3">
      <p className="text-sm font-semibold">{bet.question}</p>
      {resolved && (
        <p className="text-xs text-eurogold-400">
          Resolved: {bet.resolved_value}
        </p>
      )}
      {optionList.length <= 6 && opts.kind !== 'country' ? (
        <div className="flex flex-wrap gap-2">
          {optionList.map((o) => (
            <button
              key={o.value}
              disabled={resolved || pending}
              onClick={() => submit(o.value)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                currentPick === o.value
                  ? 'border-eurorose-400 bg-eurorose-500/30 text-eurorose-300'
                  : 'border-border/60 bg-background/40 hover:bg-secondary/60'
              } ${resolved ? 'opacity-50' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <select
          value={currentPick}
          disabled={resolved || pending}
          onChange={(e) => submit(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">— pick —</option>
          {optionList.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
