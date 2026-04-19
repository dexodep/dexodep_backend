import { Pool } from 'pg';
import { config } from './config';

const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
});

pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});

export default pool;
