// Background Classroom polling.
//
// Google Classroom can push notifications, but only through a Cloud Pub/Sub
// topic that has to be registered against a Workspace domain — not something a
// personal project can set up. Polling every half hour is the honest trade-off:
// a new assignment lands in StudyHub within ~30 minutes of being posted, with no
// extra infrastructure.
const { pool } = require('./config/db');
const { logger } = require('./lib/logger');
const { syncUserClassroom, dueForSync } = require('./lib/classroomSync');

const intervalMinutes = () => Number(process.env.CLASSROOM_SYNC_MINUTES ?? 30);

let timer = null;
let running = false;   // guards against overlapping passes on a slow API

async function runPass() {
  if (running) { logger.debug('classroom sweep still running, skipping this tick'); return; }
  running = true;
  const started = Date.now();
  let synced = 0, failed = 0;

  try {
    const [users] = await pool.execute(
      `SELECT id, google_refresh_token, google_scopes, classroom_synced_at, classroom_auto_sync
       FROM users
       WHERE google_refresh_token IS NOT NULL AND classroom_auto_sync = 1 AND role = 'student'`
    );

    const due = users.filter(u => dueForSync(u, { intervalMinutes: intervalMinutes() }));
    if (due.length === 0) return;

    for (const user of due) {
      try {
        const summary = await syncUserClassroom(user.id);
        synced++;
        if (summary.newDeadlines.length) {
          logger.info('classroom brought in new deadlines', {
            user: user.id,
            count: summary.newDeadlines.length,
            titles: summary.newDeadlines.slice(0, 3).map(d => d.title).join(' | '),
          });
        }
      } catch (err) {
        failed++;
        // One student's expired consent must not stop everyone else's sync.
        if (err.status === 401 || err.status === 428) {
          await pool.execute('UPDATE users SET google_scopes = NULL WHERE id = ?', [user.id]).catch(() => {});
          logger.warn('classroom access lost, user must reconnect', { user: user.id });
        } else {
          logger.error('classroom sync failed', { user: user.id, error: err.message });
        }
      }
    }
    logger.info('classroom sweep done', { synced, failed, ms: Date.now() - started });
  } catch (err) {
    logger.error('classroom sweep aborted', { error: err.message });
  } finally {
    running = false;
  }
}

function startScheduler() {
  const minutes = intervalMinutes();
  if (!minutes || minutes <= 0) {
    logger.info('classroom auto-sync disabled (CLASSROOM_SYNC_MINUTES=0)');
    return null;
  }
  // Check every 5 minutes; dueForSync decides who has actually aged out. That
  // spreads the work instead of syncing everyone on the same tick.
  const tickMs = Math.min(minutes, 5) * 60_000;
  timer = setInterval(runPass, tickMs);
  timer.unref?.();
  setTimeout(runPass, 20_000).unref?.();   // one pass shortly after boot
  logger.info('classroom auto-sync started', { everyMinutes: minutes });
  return timer;
}

const stopScheduler = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = { startScheduler, stopScheduler, runPass };
