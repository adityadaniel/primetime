import { importPKCS8, SignJWT } from 'jose';

let cached: { value: string; expiresAt: number } | null = null;

export async function getAppleClientSecret(): Promise<string> {
  if (process.env.ENABLE_APPLE_SIGNIN !== 'true') return '';

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.value;

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!teamId || !keyId || !clientId || !privateKey) {
    throw new Error(
      'Apple Sign-In is enabled but APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_ID, or APPLE_PRIVATE_KEY is missing.',
    );
  }

  const key = await importPKCS8(privateKey, 'ES256');
  const expiresAt = now + 60 * 60 * 24 * 180;

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(key);

  cached = { value: jwt, expiresAt };
  return jwt;
}
