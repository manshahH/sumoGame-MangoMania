// Winner-stays-on leaderboard: the champion is whoever holds the ring right
// now, and the streak is how many ring-outs they've won in a row. Pure state,
// no storage - the host decides when to also mirror it into localStorage.

export function createStreak() {
  return { championId: null, championName: null, streak: 0, best: 0, bestName: null }
}

/** Call once per finished match with the winner's identity. */
export function recordWin(streak, winnerId, winnerName) {
  if (streak.championId && streak.championId === winnerId) {
    streak.streak += 1
  } else {
    streak.championId = winnerId
    streak.championName = winnerName
    streak.streak = 1
  }
  if (streak.streak > streak.best) {
    streak.best = streak.streak
    streak.bestName = streak.championName
  }
  return streak
}
