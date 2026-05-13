/**
 * Read the configured party UUID. We deliberately throw rather than fall back
 * — a misconfigured party id is the kind of thing that should fail loudly
 * during local dev, not silently produce a phantom empty party.
 */
export const getPartyId = (): string => {
  const id = process.env.NEXT_PUBLIC_PARTY_ID;
  if (!id) {
    throw new Error(
      'NEXT_PUBLIC_PARTY_ID is not set. Set it in apps/web/.env.local after creating a party row.',
    );
  }
  return id;
};
