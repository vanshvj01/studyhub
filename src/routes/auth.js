const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { validate } = require('../lib/validate');

const router = express.Router();

// POST /api/auth/register { name, email, password }
router.post('/register', validate({
  name:     { type: 'string', required: true, maxLen: 100 },
  email:    { type: 'string', required: true, maxLen: 255 },
  password: { type: 'string', required: true, minLen: 8, trim: false },
}), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email.toLowerCase(), hash]
    );
    const user = { id: result.insertId, name, email: email.toLowerCase() };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  }
});

// POST /api/auth/login { email, password }
router.post('/login', validate({
  email:    { type: 'string', required: true },
  password: { type: 'string', required: true, trim: false },
}), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
