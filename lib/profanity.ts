const BAD_WORDS: readonly string[] = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "asshole",
  "bastard",
  "piss",
  "nigger",
  "faggot",
  "fag",
  "retard",
  "nazi",
  "whore",
  "slut",
  "tits",
  "boner",
  "penis",
];

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

function normalize(input: string, oneAs: "i" | "l"): string {
  const lower = input.toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (ch === "1") {
      out += oneAs;
      continue;
    }
    const mapped = LEET_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (ch >= "a" && ch <= "z") {
      out += ch;
    }
  }
  return out;
}

function containsBadWord(normalized: string): boolean {
  for (const word of BAD_WORDS) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

export function isClean(nickname: string): boolean {
  if (containsBadWord(normalize(nickname, "i"))) return false;
  if (containsBadWord(normalize(nickname, "l"))) return false;
  return true;
}

export function reasonForRejection(nickname: string): string | null {
  return isClean(nickname) ? null : "Pick another nickname";
}
