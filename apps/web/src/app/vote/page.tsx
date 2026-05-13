'use client';

import dynamicImport from 'next/dynamic';

// Client wrapper that loads the real page off the SSR path. dnd-kit's
// DndContext throws "is not iterable" during Next's prerender of this route,
// so we lazy-load the implementation in the browser only.
const VoteClient = dynamicImport(() => import('./_vote-client'), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  ),
});

export default function VotePage() {
  return <VoteClient />;
}
