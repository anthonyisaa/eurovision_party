'use client';

// /admin/setup — pre-show setup. Wider desktop-first layout.
//
// Four stacked sections:
//   1. Set YouTube video id (Save → setYtVideoId).
//   2. JSON ingest — paste producer payload, Validate locally with Zod,
//      then Ingest (calls SECURITY DEFINER RPC via ingestPayload action).
//   3. Bulk side-bet creation — repeatable rows.
//   4. Actual results paste — array of {position, country_code}.
//
// Auth gate is server-side (every action re-checks host_guest_id).

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { getGuestIdClient } from '@/lib/guest-id';
import { getPartyId } from '@/lib/party-id';
import {
  setYtVideoId,
  ingestPayload,
  createSideBetsBulk,
  setActualResults,
  type IngestCounts,
} from '../../actions/admin';
import {
  actualResultsSchema,
  structurePayloadSchema,
  commentaryPayloadSchema,
  mergeStructureAndCommentary,
} from '@/lib/ingest-schema';
import type { Database } from '@eurojury/db/types';

type PartyRow = Database['public']['Tables']['parties']['Row'];

type BetType = 'country' | 'binary' | 'text';
interface DraftBet {
  question: string;
  bet_type: BetType;
  options: string; // newline-separated
}

const emptyBet = (): DraftBet => ({
  question: '',
  bet_type: 'binary',
  options: 'Yes\nNo',
});

export default function AdminSetupPage() {
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setGuestId(getGuestIdClient());
    if (!partyId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    supabase
      .from('parties')
      .select('*')
      .eq('id', partyId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setParty(data ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, partyId]);

  if (!partyId) {
    return (
      <main className="mx-auto w-full max-w-4xl p-6">
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
              and join the party before doing setup.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Pre-show setup
        </p>
        <h1 className="bg-gradient-to-br from-eurorose-400 via-eurogold-400 to-europurp-500 bg-clip-text text-3xl font-black tracking-tight text-transparent md:text-4xl">
          Admin · Setup
        </h1>
        <p className="text-sm text-muted-foreground">
          Party id <code className="text-xs">{partyId}</code>
        </p>
      </header>

      <YtSection partyId={partyId} guestId={guestId} party={party} />
      <IngestSection partyId={partyId} guestId={guestId} />
      <BulkBetsSection partyId={partyId} guestId={guestId} />
      <ActualResultsSection
        partyId={partyId}
        guestId={guestId}
        currentResults={party?.actual_results}
      />
    </main>
  );
}

// --- YouTube ID -----------------------------------------------------

function YtSection({
  partyId,
  guestId,
  party,
}: {
  partyId: string;
  guestId: string;
  party: PartyRow | null;
}) {
  const [pending, startTransition] = useTransition();
  const [raw, setRaw] = useState(party?.yt_video_id ?? '');

  const onSave = () => {
    if (!raw.trim()) {
      toast.error('Enter a URL or video id');
      return;
    }
    startTransition(async () => {
      const res = await setYtVideoId(partyId, guestId, raw);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Saved video id: ${res.data.id}`);
      setRaw(res.data.id);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>YouTube video</CardTitle>
        <p className="text-xs text-muted-foreground">
          Accepts a full URL (<code>watch?v=…</code> or <code>youtu.be/…</code>)
          or the raw id.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-col gap-2 md:flex-row">
          <Input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="flex-1"
            disabled={pending}
          />
          <Button onClick={onSave} disabled={pending} className="md:w-32">
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {party?.yt_video_id && (
          <p className="text-xs text-muted-foreground">
            Current: <code>{party.yt_video_id}</code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- JSON ingest ---------------------------------------------------
//
// Two paste boxes:
//   1. Structure (Gemini)   — yt_video_id + performances + other_events
//   2. Commentary (ChatGPT) — scheduled_commentary + reaction_pool,
//                             keyed by country_code (not event_idx).
//
// Split because ChatGPT can't reliably emit one combined payload at the
// sizes we need (10+ reactions/kitten/performance ≈ 500+ lines). We
// validate each independently then merge client-side into the combined
// shape the existing `ingest_payload` RPC consumes — no DB change.
//
// Either box can be re-pasted and re-ingested independently. The RPC
// clears+reinserts atomically, so to refresh just the commentary you
// also need the structure pasted (server needs both for the merge).

function IngestSection({
  partyId,
  guestId,
}: {
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [structureText, setStructureText] = useState('');
  const [commentaryText, setCommentaryText] = useState('');
  const [validation, setValidation] = useState<
    { ok: true; message: string } | { ok: false; error: string } | null
  >(null);
  const [counts, setCounts] = useState<IngestCounts | null>(null);

  // Build the merged IngestPayload from the two textareas. Returns either a
  // ready-to-send JSON string + a summary, or an error to surface inline.
  const buildMerged = (): { ok: true; json: string; summary: string } | { ok: false; error: string } => {
    let parsedStructure: unknown;
    try {
      parsedStructure = JSON.parse(structureText);
    } catch (err) {
      return { ok: false, error: `Structure JSON parse: ${(err as Error).message}` };
    }
    const sRes = structurePayloadSchema.safeParse(parsedStructure);
    if (!sRes.success) {
      const first = sRes.error.issues[0];
      const path = first?.path?.join('.') ?? '';
      return {
        ok: false,
        error: `Structure: ${first?.message ?? 'invalid'}${path ? ` (at ${path})` : ''}`,
      };
    }

    let parsedCommentary: unknown;
    if (commentaryText.trim()) {
      try {
        parsedCommentary = JSON.parse(commentaryText);
      } catch (err) {
        return { ok: false, error: `Commentary JSON parse: ${(err as Error).message}` };
      }
    } else {
      parsedCommentary = { scheduled_commentary: [], reaction_pool: [] };
    }
    const cRes = commentaryPayloadSchema.safeParse(parsedCommentary);
    if (!cRes.success) {
      const first = cRes.error.issues[0];
      const path = first?.path?.join('.') ?? '';
      return {
        ok: false,
        error: `Commentary: ${first?.message ?? 'invalid'}${path ? ` (at ${path})` : ''}`,
      };
    }

    const merged = mergeStructureAndCommentary(sRes.data, cRes.data);
    if (!merged.ok) return merged;

    const p = merged.payload;
    const roastCount = p.reaction_pool.filter((r) => r.kind === 'roast').length;
    const celebrateCount = p.reaction_pool.filter((r) => r.kind === 'celebrate').length;
    const summary =
      `${p.performances.length} performances, ` +
      `${p.other_events.length} other events, ` +
      `${p.scheduled_commentary.length} commentary, ` +
      `${roastCount} roasts + ${celebrateCount} celebrates`;
    return { ok: true, json: JSON.stringify(p), summary };
  };

  const validate = () => {
    setCounts(null);
    setValidation(null);
    const built = buildMerged();
    if (!built.ok) {
      setValidation(built);
      return;
    }
    setValidation({ ok: true, message: built.summary });
    toast.success(`Valid: ${built.summary}`);
  };

  const ingest = () => {
    setCounts(null);
    const built = buildMerged();
    if (!built.ok) {
      setValidation(built);
      toast.error(built.error);
      return;
    }
    startTransition(async () => {
      const res = await ingestPayload(partyId, guestId, built.json);
      if (!res.ok) {
        toast.error(res.error);
        setValidation({ ok: false, error: res.error });
        return;
      }
      setCounts(res.data);
      setValidation(null);
      toast.success(
        `Ingested ${res.data.performances} performances, ` +
          `${res.data.scheduled_commentary} commentary, ` +
          `${res.data.roast_pool} roasts, ${res.data.celebrate_pool ?? 0} celebrates, ` +
          `${res.data.other_events} other events`,
      );
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest producer JSON</CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste Gemini&apos;s structural output in the first box and ChatGPT&apos;s
          kittens commentary in the second. They&apos;re merged on submit by{' '}
          <code>country_code</code> → performance. Idempotent — re-ingest clears
          existing rows for this party first.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step A · Video structure (Gemini)
            </label>
            <span className="text-[10px] text-muted-foreground">
              yt_video_id · performances · other_events
            </span>
          </div>
          <Textarea
            rows={14}
            spellCheck={false}
            value={structureText}
            onChange={(e) => setStructureText(e.target.value)}
            placeholder='{"yt_video_id": "Yy510SZZDw4", "performances": [{ "running_order": 1, "country_code": "MD", ... }], "other_events": [{ "category": "opening", "start_seconds": 0, "description": "..." }]}'
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step B · Kittens commentary (ChatGPT)
            </label>
            <span className="text-[10px] text-muted-foreground">
              scheduled_commentary · reaction_pool (keyed by country_code)
            </span>
          </div>
          <Textarea
            rows={18}
            spellCheck={false}
            value={commentaryText}
            onChange={(e) => setCommentaryText(e.target.value)}
            placeholder='{"scheduled_commentary": [{ "trigger_seconds": 815, "country_code": "MD", "speaker": "nala", "content": "..." }], "reaction_pool": [{ "country_code": "MD", "kind": "roast", "speaker": "evee", "content": "..." }]}'
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={validate} variant="secondary" disabled={pending}>
            Validate
          </Button>
          <Button
            onClick={ingest}
            disabled={pending || !structureText.trim()}
          >
            {pending ? 'Ingesting…' : 'Ingest payload'}
          </Button>
        </div>
        {validation && !validation.ok && (
          <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {validation.error}
          </pre>
        )}
        {validation && validation.ok && !counts && (
          <p className="text-xs text-eurogold-400">✓ {validation.message}</p>
        )}
        {counts && (
          <div className="rounded-md border border-eurogold-500/40 bg-eurogold-500/10 p-3 text-sm">
            <p className="font-semibold text-eurogold-400">
              ✓ Ingested {counts.performances} performances, {counts.scheduled_commentary}{' '}
              commentary lines, {counts.roast_pool} roasts, {counts.celebrate_pool ?? 0}{' '}
              celebrates, {counts.other_events} other events
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              countries_updated: {counts.countries_updated}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- bulk side bets -----------------------------------------------

function BulkBetsSection({
  partyId,
  guestId,
}: {
  partyId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<DraftBet[]>([emptyBet()]);

  const update = (i: number, patch: Partial<DraftBet>) =>
    setDrafts((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const remove = (i: number) =>
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setDrafts((prev) => [...prev, emptyBet()]);

  const submit = () => {
    const bets = drafts
      .filter((d) => d.question.trim())
      .map((d) => ({
        question: d.question.trim(),
        bet_type: d.bet_type,
        options:
          d.bet_type === 'country'
            ? []
            : d.options
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
      }));
    if (bets.length === 0) {
      toast.error('Add at least one bet with a question');
      return;
    }
    // local validation: non-country bets need >= 2 options
    for (const b of bets) {
      if (b.bet_type !== 'country' && b.options.length < 2) {
        toast.error(`"${b.question}" needs at least 2 options`);
        return;
      }
    }
    startTransition(async () => {
      const res = await createSideBetsBulk(partyId, guestId, bets);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Created ${res.data.count} bets`);
      setDrafts([emptyBet()]);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk create side bets</CardTitle>
        <p className="text-xs text-muted-foreground">
          Country bets show all countries automatically; binary/text bets use
          one option per line.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {drafts.map((d, i) => (
          <div
            key={i}
            className="grid gap-3 rounded-lg border border-border/60 bg-secondary/20 p-3 md:grid-cols-12"
          >
            <div className="md:col-span-6 md:order-1">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Question
              </label>
              <Input
                value={d.question}
                onChange={(e) => update(i, { question: e.target.value })}
                placeholder="Who will host the most?"
                disabled={pending}
              />
            </div>
            <div className="md:col-span-3 md:order-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Type
              </label>
              <select
                value={d.bet_type}
                onChange={(e) =>
                  update(i, { bet_type: e.target.value as BetType })
                }
                disabled={pending}
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="binary">binary</option>
                <option value="text">text</option>
                <option value="country">country</option>
              </select>
            </div>
            <div className="md:col-span-3 md:order-3 flex items-end justify-end">
              <Button
                onClick={() => remove(i)}
                disabled={pending || drafts.length <= 1}
                variant="outline"
                size="sm"
              >
                Remove
              </Button>
            </div>
            <div className="md:col-span-12 md:order-4">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Options (one per line)
              </label>
              <Textarea
                value={d.bet_type === 'country' ? '(any country)' : d.options}
                onChange={(e) => update(i, { options: e.target.value })}
                disabled={pending || d.bet_type === 'country'}
                rows={3}
                className="font-mono text-xs"
              />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={add} variant="secondary" disabled={pending}>
            + Add another bet
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Creating…' : 'Create all bets'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- actual results -----------------------------------------------

function ActualResultsSection({
  partyId,
  guestId,
  currentResults,
}: {
  partyId: string;
  guestId: string;
  currentResults: unknown;
}) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(
    currentResults ? JSON.stringify(currentResults, null, 2) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const onSave = () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`JSON parse: ${(err as Error).message}`);
      return;
    }
    const z = actualResultsSchema.safeParse(parsed);
    if (!z.success) {
      const first = z.error.issues[0];
      const path = first?.path?.join('.') ?? '';
      setError(`${first?.message ?? 'invalid'}${path ? ` (at ${path})` : ''}`);
      return;
    }
    startTransition(async () => {
      const res = await setActualResults(partyId, guestId, text);
      if (!res.ok) {
        toast.error(res.error);
        setError(res.error);
        return;
      }
      toast.success(`Saved ${res.data.count} actual results`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actual results</CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste the final standings as a JSON array of{' '}
          <code>{'{position, country_code}'}</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='[{"position": 1, "country_code": "SE"}, {"position": 2, "country_code": "FI"}]'
          className="font-mono text-xs"
        />
        {error && (
          <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </pre>
        )}
        <Button onClick={onSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save actual results'}
        </Button>
      </CardContent>
    </Card>
  );
}
