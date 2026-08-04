// The Mango Mania leaderboard.
//
// Ranked by mangoes earned across a whole match (all rounds combined), because
// mangoes are the skill currency - you only get one by reading a parry or
// stringing a combo, never by luck or position. Ties break on total hits
// landed, so the more active fighter edges it.
//
// Pure functions over a plain object, so the ranking rules can be tested
// without a browser and the host can just persist whatever comes back.

export const LEADERBOARD_SIZE = 5

export function createLeaderboard() {
  return { entries: [] }
}

/**
 * Sort order: mangoes desc, then hits desc, then oldest first so an existing
 * holder is not displaced by a later identical score.
 */
export function compareEntries(a, b) {
  if (b.mangoes !== a.mangoes) return b.mangoes - a.mangoes
  if (b.hits !== a.hits) return b.hits - a.hits
  return (a.at || 0) - (b.at || 0)
}

export function rankOf(board, entry) {
  const sorted = [...board.entries, entry].sort(compareEntries)
  return sorted.indexOf(entry) + 1
}

/** True when this run is good enough to make the board at all. */
export function qualifies(board, entry) {
  if (!entry || entry.mangoes <= 0) return false // a blank run is not a score
  if (board.entries.length < LEADERBOARD_SIZE) return true
  return rankOf(board, entry) <= LEADERBOARD_SIZE
}

/** True when this run beats everything already on the board. */
export function isNewRecord(board, entry) {
  if (!entry || entry.mangoes <= 0) return false
  if (!board.entries.length) return true
  return compareEntries(entry, board.entries[0]) < 0
}

/** Returns a NEW board with the entry inserted and trimmed to size. */
export function addEntry(board, entry) {
  const entries = [...board.entries, { ...entry }]
    .sort(compareEntries)
    .slice(0, LEADERBOARD_SIZE)
  return { ...board, entries }
}

/** Tolerates a missing or half-written blob from storage. */
export function normalize(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : []
  return {
    entries: entries
      .filter((e) => e && typeof e.mangoes === 'number')
      .map((e) => ({
        name: String(e.name || 'ANON').slice(0, 12),
        mangoes: Math.max(0, Math.floor(e.mangoes)),
        hits: Math.max(0, Math.floor(e.hits || 0)),
        rounds: Math.max(0, Math.floor(e.rounds || 0)),
        won: !!e.won,
        at: Number(e.at) || 0,
      }))
      .sort(compareEntries)
      .slice(0, LEADERBOARD_SIZE),
  }
}
