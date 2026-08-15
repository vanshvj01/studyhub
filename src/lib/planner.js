// Study planner. Given deadlines, exams and their syllabus, it works backwards
// from each due date and lays out study blocks on the days in between.
//
// Kept pure — no database, no clock of its own — so the scheduling rules can be
// tested directly and the same code runs for a preview or a saved plan.

const DAY_MS = 86_400_000;
const iso = d => new Date(d).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(date).getTime() + n * DAY_MS);
const daysBetween = (a, b) => Math.round((new Date(iso(b)) - new Date(iso(a))) / DAY_MS);

// Baseline effort before weighting.
const EFFORT = {
  assignment: 90,   // minutes for a typical assignment
  topic: 30,        // minutes per difficulty point for one syllabus topic
  exam: 150,        // per weight point, used only when an exam has no syllabus attached
};

// How much work a topic still needs, by how well it is already known.
const MASTERY = {
  not_started: 1,
  learning: 0.7,
  revised: 0.4,
  mastered: 0.15,   // a quick look, not a re-learn
};

/** Minutes one syllabus topic should get before an exam. */
function topicEffort(topic) {
  const difficulty = Math.min(Math.max(Number(topic.difficulty) || 3, 1), 5);
  const factor = MASTERY[topic.status] ?? 1;
  return Math.round(EFFORT.topic * difficulty * factor);
}

/**
 * Turns exams into schedulable items. An exam with a syllabus portion becomes one
 * item per topic, so the plan says "revise Normalization" rather than "study for
 * the exam". An exam with no topics attached stays a single block.
 */
function expandExams(exams = []) {
  const items = [];
  for (const exam of exams) {
    const topics = exam.topics || [];
    if (topics.length === 0) {
      const weight = Math.min(Math.max(Number(exam.weight) || 3, 1), 5);
      items.push({
        id: `exam-${exam.id}`,
        type: 'exam',
        title: exam.title,
        courseCode: exam.courseCode || null,
        due: exam.due,
        weight,
        effort: EFFORT.exam * weight,
      });
      continue;
    }
    for (const topic of topics) {
      items.push({
        id: `topic-${topic.id}`,
        type: 'topic',
        title: topic.title,
        unit: topic.unit || null,
        courseCode: exam.courseCode || null,
        examTitle: exam.title,
        examId: exam.id,
        due: exam.due,
        difficulty: Number(topic.difficulty) || 3,
        status: topic.status || 'not_started',
        weight: Math.min(Math.max(Number(topic.difficulty) || 3, 1), 5),
        effort: topicEffort(topic),
        orderIndex: Number(topic.orderIndex) || 0,
      });
    }
  }
  return items;
}

/**
 * @param {object[]} items  assignments already shaped as { id, type:'assignment', title, due, weight? }
 *                          plus whatever expandExams produced
 * @param {object}   opts   { today, dailyMinutes, horizonDays, minBlock }
 */
function buildPlan(items = [], opts = {}) {
  const today = iso(opts.today || new Date());
  const dailyMinutes = Math.max(15, Number(opts.dailyMinutes) || 60);
  const horizonDays = Math.max(1, Number(opts.horizonDays) || 14);
  const minBlock = Math.max(10, Number(opts.minBlock) || 25);

  const pending = items
    .filter(i => i.due && daysBetween(today, i.due) >= 0)
    .map(i => {
      const weight = Math.min(Math.max(Number(i.weight) || (i.type === 'exam' ? 3 : 1), 1), 5);
      const effort = Number(i.effort) || (i.type === 'exam' ? EFFORT.exam * weight : EFFORT.assignment * weight);
      return { ...i, weight, effort, remaining: effort, daysLeft: daysBetween(today, i.due) };
    })
    // Nearest deadline first; within an exam, harder topics before easier ones,
    // then syllabus order so a student still moves through the course in sequence.
    .sort((a, b) =>
      a.daysLeft - b.daysLeft ||
      b.weight - a.weight ||
      (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
    );

  const days = [];
  for (let offset = 0; offset < horizonDays; offset++) {
    days.push({ date: iso(addDays(today, offset)), capacity: dailyMinutes, blocks: [], totalMinutes: 0 });
  }

  const warnings = [];

  for (const item of pending) {
    // The day something is due is left free — that day is for sitting the exam or
    // handing the work in, not for studying it for the first time.
    const usable = days.filter(d => d.date < item.due || (item.daysLeft === 0 && d.date === item.due));
    if (usable.length === 0) {
      warnings.push({ id: item.id, title: item.title, reason: 'due today — no time left to schedule' });
      continue;
    }

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
        unit: item.unit || null,
        courseCode: item.courseCode || null,
        examTitle: item.examTitle || null,
        difficulty: item.difficulty || null,
        status: item.status || null,
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
        examTitle: item.examTitle || null,
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
      topics: pending.filter(i => i.type === 'topic').length,
      scheduledMinutes: scheduled,
      requiredMinutes: pending.reduce((s, i) => s + i.effort, 0),
      capacityMinutes: dailyMinutes * horizonDays,
      busiestDay: days.reduce((max, d) => (d.totalMinutes > (max?.totalMinutes || 0) ? d : max), null)?.date || null,
    },
  };
}

module.exports = { buildPlan, expandExams, topicEffort, EFFORT, MASTERY };
