// Study planner. Given deadlines and how much you can study per day, it works
// backwards from each due date and lays out blocks on the days in between.
//
// Kept pure — no database, no clock of its own — so the scheduling rules can be
// tested directly and the same code runs for a preview or a saved plan.

const DAY_MS = 86_400_000;
const iso = d => new Date(d).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(date).getTime() + n * DAY_MS);
const daysBetween = (a, b) => Math.round((new Date(iso(b)) - new Date(iso(a))) / DAY_MS);

// How much work each kind of deadline is assumed to need, before weighting.
const EFFORT = {
  assignment: 90,   // minutes
  exam: 150,        // per weight point: a weight-4 exam budgets 600 minutes
};

/**
 * @param {object[]} items  { id, type: 'assignment'|'exam', title, courseCode, due: 'YYYY-MM-DD', weight? }
 * @param {object}   opts   { today, dailyMinutes, horizonDays, minBlock }
 * @returns {{ days: object[], warnings: object[], totals: object }}
 */
function buildPlan(items = [], opts = {}) {
  const today = iso(opts.today || new Date());
  const dailyMinutes = Math.max(15, Number(opts.dailyMinutes) || 60);
  const horizonDays = Math.max(1, Number(opts.horizonDays) || 14);
  const minBlock = Math.max(10, Number(opts.minBlock) || 25);

  // Only things still ahead of us, soonest first; a tie breaks toward heavier work.
  const pending = items
    .filter(i => i.due && daysBetween(today, i.due) >= 0)
    .map(i => {
      const weight = Math.min(Math.max(Number(i.weight) || (i.type === 'exam' ? 3 : 1), 1), 5);
      const effort = i.type === 'exam' ? EFFORT.exam * weight : EFFORT.assignment * weight;
      return { ...i, weight, effort, remaining: effort, daysLeft: daysBetween(today, i.due) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || b.weight - a.weight);

  // Capacity per day. The day something is due is left free — that day is for
  // sitting the exam or handing the work in, not for first-time studying.
  const days = [];
  for (let offset = 0; offset < horizonDays; offset++) {
    days.push({ date: iso(addDays(today, offset)), capacity: dailyMinutes, blocks: [], totalMinutes: 0 });
  }
  const dayByDate = Object.fromEntries(days.map(d => [d.date, d]));

  const warnings = [];

  for (const item of pending) {
    // Candidate days: from today up to the day before it is due.
    const usable = days.filter(d => d.date < item.due || (item.daysLeft === 0 && d.date === item.due));
    if (usable.length === 0) {
      warnings.push({ id: item.id, title: item.title, reason: 'due today — no time left to schedule' });
      continue;
    }

    // Nearest deadlines claim time first, but spread across all available days so
    // one big exam does not swallow tomorrow entirely.
    const perDayTarget = Math.max(minBlock, Math.ceil(item.remaining / usable.length));

    for (const day of usable) {
      if (item.remaining <= 0) break;
      const free = day.capacity - day.totalMinutes;
      if (free < minBlock) continue;
      const minutes = Math.min(perDayTarget, free, item.remaining);
      if (minutes < minBlock) continue;
      day.blocks.push({
        id: item.id,
        type: item.type,
        title: item.title,
        courseCode: item.courseCode || null,
        minutes,
        due: item.due,
        daysLeft: daysBetween(day.date, item.due),
      });
      day.totalMinutes += minutes;
      item.remaining -= minutes;
    }

    if (item.remaining > 0) {
      warnings.push({
        id: item.id,
        title: item.title,
        reason: `${Math.round(item.remaining / 60 * 10) / 10}h could not be scheduled before the deadline`,
        shortfallMinutes: item.remaining,
      });
    }
  }

  const scheduled = days.reduce((sum, d) => sum + d.totalMinutes, 0);
  return {
    days,
    warnings,
    totals: {
      items: pending.length,
      scheduledMinutes: scheduled,
      requiredMinutes: pending.reduce((s, i) => s + i.effort, 0),
      capacityMinutes: dailyMinutes * horizonDays,
      busiestDay: days.reduce((max, d) => (d.totalMinutes > (max?.totalMinutes || 0) ? d : max), null)?.date || null,
    },
  };
}

module.exports = { buildPlan, EFFORT };
