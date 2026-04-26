"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Validate required environment variables
const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_CALLBACK_URL',
];
const missing = requiredEnvVars.filter(env => !process.env[env]);
if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Check your .env file and ensure all variables are set.');
    process.exit(1);
}
exports.config = {
    port: parseInt(process.env.PORT || '4000', 10),
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackUrl: process.env.GITHUB_CALLBACK_URL,
        allowSelfSignedCerts: process.env.GITHUB_ALLOW_SELF_SIGNED_CERTS === 'true',
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
// Optional escape hatch for environments injecting custom/self-signed TLS certs.
if (exports.config.github.allowSelfSignedCerts) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.warn('⚠ GITHUB_ALLOW_SELF_SIGNED_CERTS=true: TLS certificate verification is disabled for outgoing HTTPS requests.');
}
//# sourceMappingURL=config.js.map