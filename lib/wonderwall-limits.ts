// Shared WonderWall input limits. Kept separate from wonderwall-repo so client
// pages can import UI max-lengths without pulling Prisma/DB code into the
// browser bundle.

export const WONDERWALL_TITLE_MAX = 100;
export const WONDERWALL_DESCRIPTION_MAX = 200;
export const WONDERWALL_INSTRUCTIONS_MAX = 240;
