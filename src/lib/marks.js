// Grade maths kept pure so it can be unit-tested without a database.
const BANDS = [[90, 'A+'], [80, 'A'], [70, 'B'], [60, 'C'], [50, 'D'], [40, 'E']];

const letterFor = pct => (BANDS.find(([min]) => pct >= min) || [0, 'F'])[1];

const round1 = n => Math.round(n * 10) / 10;

/** Weighted average of [{ pct, weight }] — falls back to 0 when there is nothing to average. */
function weightedAverage(items) {
  const totalWeight = items.reduce((a, i) => a + (Number(i.weight) || 0), 0);
  if (!totalWeight) return 0;
  return round1(items.reduce((a, i) => a + i.pct * i.weight, 0) / totalWeight);
}

const percentOf = (score, maxScore) => (Number(maxScore) ? (Number(score) / Number(maxScore)) * 100 : 0);

/** Mean of per-course averages. */
const overallAverage = courses => (courses.length ? round1(courses.reduce((a, c) => a + c.average, 0) / courses.length) : 0);

module.exports = { letterFor, weightedAverage, percentOf, overallAverage, round1 };
