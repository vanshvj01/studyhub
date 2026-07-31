// Fail fast with a readable message instead of a stack trace three layers deep.
const { logger } = require('../lib/logger');

const DEFAULTS = {
  PORT: '3000',
  MYSQL_HOST: 'localhost',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'studyhub',
  MYSQL_PASSWORD: 'studyhub_pass',
  MYSQL_DATABASE: 'studyhub',
  MONGO_URI: 'mongodb://localhost:27017/studyhub',
  JWT_EXPIRES_IN: '7d',
};

const WEAK_SECRETS = ['change_me_to_a_long_random_string', 'secret', 'changeme', 'test'];

function loadEnv() {
  const problems = [];

  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!process.env[key]) process.env[key] = fallback;
  }

  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set. Copy .env.example to .env and set a long random value.');
  } else if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET.length < 32 || WEAK_SECRETS.includes(process.env.JWT_SECRET))) {
    problems.push('JWT_SECRET is too weak for production — use at least 32 random characters.');
  }

  if (Number.isNaN(Number(process.env.PORT)) || Number(process.env.PORT) <= 0) {
    problems.push(`PORT must be a positive number (got "${process.env.PORT}").`);
  }
  if (Number.isNaN(Number(process.env.MYSQL_PORT))) {
    problems.push(`MYSQL_PORT must be a number (got "${process.env.MYSQL_PORT}").`);
  }
  if (!/^mongodb(\+srv)?:\/\//.test(process.env.MONGO_URI)) {
    problems.push('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }

  if (problems.length) {
    logger.error('Configuration problems found:');
    problems.forEach(p => logger.error('  - ' + p));
    process.exit(1);
  }

  return {
    port: Number(process.env.PORT),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

module.exports = { loadEnv, DEFAULTS };
