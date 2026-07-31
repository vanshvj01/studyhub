// Daily streak from a list of study dates (newest first, 'YYYY-MM-DD').
// A streak stays alive if the most recent study day is today or yesterday.
const DAY_MS = 86_400_000;
const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

function computeStreak(dates, now = new Date()) {
  if (!Array.isArray(dates) || dates.length === 0) return 0;
  const today = midnight(now);
  let expected = midnight(dates[0]);
  if (today - expected > DAY_MS) return 0;

  let streak = 0;
  for (const d of dates) {
    const cur = midnight(d);
    if (cur === expected) { streak++; expected -= DAY_MS; }
    else if (cur < expected) break;
  }
  return streak;
}

module.exports = { computeStreak };
