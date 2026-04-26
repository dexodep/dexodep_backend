"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const config_1 = require("./config");
const pool = new pg_1.Pool({
    connectionString: config_1.config.databaseUrl,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
});
pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});
exports.default = pool;
//# sourceMappingURL=db.js.map