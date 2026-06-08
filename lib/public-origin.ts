export function normalizeOrigin(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function publicOrigin(fallback?: string | null): string {
  return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? normalizeOrigin(fallback) ?? '';
}

export function publicUrl(path: string, fallbackOrigin?: string | null): string {
  const origin = publicOrigin(fallbackOrigin);
  const pathname = path.startsWith('/') ? path : `/${path}`;
  return origin ? `${origin}${pathname}` : pathname;
}

export function publicHost(fallbackOrigin?: string | null): string {
  const origin = publicOrigin(fallbackOrigin);
  if (!origin) return '';
  return new URL(origin).host;
}
