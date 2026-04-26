import dotenv from 'dotenv';
import https from 'https';
dotenv.config();

// Create HTTPS agent that handles self-signed certs for GitHub API calls
// This is needed for environments with intercepting proxies or self-signed cert chains
const githubFetchAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
});

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

export const config = {
    port: parseInt(process.env.PORT || '4000', 10),
    databaseUrl: process.env.DATABASE_URL!,
    jwtSecret: process.env.JWT_SECRET!,
    github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        callbackUrl: process.env.GITHUB_CALLBACK_URL!,
        fetchAgent: githubFetchAgent,
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

console.log('✓ GitHub OAuth HTTPS agent configured for self-signed cert support');
