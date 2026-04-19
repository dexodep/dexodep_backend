import { Pool } from 'pg';
import { config } from './config';

const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
});

pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});

export default pool;
