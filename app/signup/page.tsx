import SignUpClient from './SignUpClient';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  // Default OFF for self-host: open signup. Operators can flip
  // REQUIRE_INVITE_CODE=true to gate signups behind a beta code.
  const requireInviteCode = (process.env.REQUIRE_INVITE_CODE ?? 'false').toLowerCase() === 'true';
  return <SignUpClient requireInviteCode={requireInviteCode} />;
}
