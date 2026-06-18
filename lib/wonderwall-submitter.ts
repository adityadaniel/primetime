// Browser-scoped submitter identity for WonderWall participants (MID-400).
//
// A WonderWall submission carries an opaque `submitterKey` so a participant can
// later see feedback (pending/approved/rejected/failed) for the posts THEY sent
// from THIS browser. It is a convenience correlation id stored in
// sessionStorage — explicitly NOT a security/auth boundary (the server treats
// it as untrusted; see lib/wonderwall-repo.ts getPostsForSubmitter). The
// matching display nickname uses the shared `bc:nick:${pin}` convention.

// sessionStorage key holding the opaque submitter key for one wall.
export function submitterStorageKey(pin: string): string {
  return `bc:wonderwall:submitter:${pin}`;
}

// Mint a random, opaque submitter key. crypto.randomUUID is available in all
// browsers we target; fall back to a timestamp+random string if it is not.
export function newSubmitterKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Read the submitter key for a wall, minting and persisting one on first use.
// Returns null only when sessionStorage is unavailable (e.g. SSR), so callers
// should treat null as "not in a browser yet".
export function ensureSubmitterKey(pin: string): string | null {
  if (typeof window === 'undefined') return null;
  const storageKey = submitterStorageKey(pin);
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const minted = newSubmitterKey();
  window.sessionStorage.setItem(storageKey, minted);
  return minted;
}
