// Code-level product constants for the OSS build.
//
// Keep user-facing, non-secret product knobs here instead of `.env` so
// self-hosters can adjust behavior by editing code without learning the env
// surface. Environment variables remain for deployment-specific secrets and
// provider selection.

/** Max concurrent players per live quiz room. */
export const PLAYER_CAP = 150;
