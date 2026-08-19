// The product catalogue and the rules for what each plan unlocks.
//
// Prices live here rather than in the database so a change is a reviewed commit,
// not an UPDATE nobody can trace. Amounts are in paise — money is never a float.

const PLANS = {
  exam_pass_30: {
    code: 'exam_pass_30',
    name: 'Exam pass',
    blurb: 'Full revision planning for the next 30 days',
    amountPaise: 7900,
    days: 30,
    source: 'exam_pass',
    recurring: false,
  },
  exam_pass_season: {
    code: 'exam_pass_season',
    name: 'Exam season pass',
    blurb: 'The whole exam season — 90 days',
    amountPaise: 19900,
    days: 90,
    source: 'exam_pass',
    recurring: false,
    badge: 'Best value',
  },
};

// What the free tier allows. Anything beyond this needs an active entitlement.
const FREE_LIMITS = {
  planHorizonDays: 7,      // Pro plans up to 60 days ahead
  examsWithPortions: 1,    // topic-level portions for one exam only
  classroomAutoSync: false,
  printableSchedule: false,
};

const PRO_LIMITS = {
  planHorizonDays: 60,
  examsWithPortions: Infinity,
  classroomAutoSync: true,
  printableSchedule: true,
};

const listPlans = () => Object.values(PLANS).map(p => ({
  code: p.code, name: p.name, blurb: p.blurb, days: p.days,
  amountPaise: p.amountPaise, price: formatPrice(p.amountPaise), badge: p.badge || null,
}));

const getPlan = code => PLANS[code] || null;

const formatPrice = paise => `₹${(paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)}`;

/**
 * Resolves a set of entitlement rows into the answer every request needs.
 * Passes stack: buying again while still covered extends the end date rather
 * than wasting the overlap, which is what a student panicking twice a semester
 * actually expects.
 */
function resolveAccess(rows = [], now = new Date()) {
  const live = rows
    .filter(r => !r.revoked_at && new Date(r.access_until) > now)
    .sort((a, b) => new Date(b.access_until) - new Date(a.access_until));

  if (live.length === 0) {
    return { pro: false, until: null, sources: [], limits: FREE_LIMITS };
  }
  return {
    pro: true,
    until: live[0].access_until,
    sources: [...new Set(live.map(r => r.source))],
    limits: PRO_LIMITS,
    grantedBy: live[0].granted_by || null,
  };
}

/**
 * Where a new pass should end: from now, or from the end of existing access if
 * the student still has some left.
 */
function nextAccessUntil(currentUntil, days, now = new Date()) {
  const start = currentUntil && new Date(currentUntil) > now ? new Date(currentUntil) : now;
  return new Date(start.getTime() + days * 86_400_000);
}

module.exports = { PLANS, FREE_LIMITS, PRO_LIMITS, listPlans, getPlan, resolveAccess, nextAccessUntil, formatPrice };
