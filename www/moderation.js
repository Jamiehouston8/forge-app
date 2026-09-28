// Forge moderation helpers, shared by forges.html and forge-onboarding.html.
//
// cleanName(s)      → a username safe to put in HTML (letters, numbers, # _ . - and
//                     spaces only, max 30 chars). Use it on every name that came
//                     from another user: leaderboard, friends, notifications.
// isOffensiveName(s) → true if a chosen username contains an obvious slur or
//                     profanity (App Store guideline 1.2 asks for a filter).
//                     Checks through l33t spellings and separators.

const ForgeModeration = (function () {
  // Kept short on purpose: strong words only, so ordinary names don't trip it.
  const BLOCKED = [
    'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'wank', 'twat', 'prick', 'dick', 'cock', 'pussy',
    'slut', 'whore', 'porn', 'rape', 'rapist', 'nazi', 'hitler', 'kkk', 'nigger', 'nigga', 'faggot',
    'fag', 'retard', 'spastic', 'paki', 'chink', 'kike', 'tranny', 'dyke', 'coon', 'wetback', 'pedo',
    'paedo', 'nonce', 'molest', 'killyourself', 'kys',
  ];
  // Short words that are only a problem as the whole name or a whole word.
  const WHOLE_ONLY = new Set(['fag', 'coon', 'dick', 'cock', 'prick', 'kys', 'paki', 'rape', 'rapist', 'pedo', 'wank', 'dyke', 'porn']);
  const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };

  function cleanName(s) {
    return String(s == null ? '' : s).replace(/[^\p{L}\p{N}#_ .-]/gu, '').trim().slice(0, 30);
  }

  function isOffensiveName(s) {
    const raw = String(s || '').toLowerCase();
    const leet = raw.replace(/[0-9!|@$]/g, c => LEET[c] || c);
    const squashed = leet.replace(/[^a-z]/g, '');            // "f.u_c k" → "fuck"
    const words = leet.split(/[^a-z]+/).filter(Boolean);
    return BLOCKED.some(w => WHOLE_ONLY.has(w)
      ? words.includes(w) || squashed === w
      : squashed.includes(w));
  }

  return { cleanName, isOffensiveName };
})();
