import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => {
  console.error('pg pool error', err);
});
