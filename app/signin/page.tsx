import { config } from '@/lib/config';
import SignInClient from './SignInClient';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  // Gate the Apple button through lib/config so the UI matches the providers
  // actually registered in auth.ts. `config.appleEnabled` is true only when
  // AUTH_MODE=password+oauth AND ENABLE_APPLE_SIGNIN=true AND the APPLE_* vars
  // are present — the OSS default is password-only, so no OAuth button shows.
  const enableApple = config.appleEnabled;
  return <SignInClient enableApple={enableApple} />;
}
