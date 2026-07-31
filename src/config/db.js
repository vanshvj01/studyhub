// Two stores, one app:
//  - MySQL  -> structured coursework data (users, courses, enrollments, progress)
//  - MongoDB -> unstructured note content (rich text, tags, votes)
const mysql = require('mysql2/promise');
const { logger } = require('../lib/logger');
const mongoose = require('mongoose');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'studyhub',
  password: process.env.MYSQL_PASSWORD || 'studyhub_pass',
  database: process.env.MYSQL_DATABASE || 'studyhub',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/studyhub';
  await mongoose.connect(uri);
  logger.info('MongoDB connected');
}

async function pingMySQL() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  logger.info('MySQL connected');
}

module.exports = { pool, connectMongo, pingMySQL };
