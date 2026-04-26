"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/auth/github → redirect to GitHub OAuth
router.get('/github', (_req, res) => {
    const params = new URLSearchParams({
        client_id: config_1.config.github.clientId,
        redirect_uri: config_1.config.github.callbackUrl,
        scope: 'read:user user:email repo',
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});
// GET /api/auth/github/callback → exchange code, save user, return JWT
router.get('/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'Missing code parameter' });
        return;
    }
    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                client_id: config_1.config.github.clientId,
                client_secret: config_1.config.github.clientSecret,
                code,
                redirect_uri: config_1.config.github.callbackUrl,
            }),
        });
        const tokenData = await tokenResponse.json();
        if (tokenData.error || !tokenData.access_token) {
            console.error('GitHub token exchange error:', {
                status: tokenResponse.status,
                error: tokenData.error,
                response: tokenData,
            });
            res.status(400).json({ error: 'Failed to get access token from GitHub', details: tokenData.error });
            return;
        }
        const accessToken = tokenData.access_token;
        // Fetch user info from GitHub
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
            },
        });
        if (!userResponse.ok) {
            console.error('GitHub user fetch error:', {
                status: userResponse.status,
                statusText: userResponse.statusText,
            });
            res.status(400).json({ error: 'Failed to fetch user from GitHub', details: `Status ${userResponse.status}` });
            return;
        }
        const userData = await userResponse.json();
        if (!userData.id || !userData.login) {
            console.error('Invalid GitHub user data:', userData);
            res.status(400).json({ error: 'Invalid user data from GitHub' });
            return;
        }
        // Upsert user in DB
        const result = await db_1.default.query(`INSERT INTO users (github_id, github_username, avatar_url, access_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (github_id)
       DO UPDATE SET github_username = $2, avatar_url = $3, access_token = $4
       RETURNING id`, [userData.id, userData.login, userData.avatar_url, accessToken]);
        const userId = result.rows[0].id;
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId }, config_1.config.jwtSecret, { expiresIn: '7d' });
        // Redirect to frontend with token
        res.redirect(`${config_1.config.frontendUrl}/auth/callback?token=${token}`);
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('GitHub OAuth callback error:', {
            message: errorMsg,
            stack: errorStack,
            type: error instanceof Error ? error.constructor.name : typeof error,
        });
        res.status(500).json({ error: 'Authentication failed', details: errorMsg });
    }
});
// GET /api/auth/me → return current user
router.get('/me', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT id, github_id, github_username, avatar_url, created_at FROM users WHERE id = $1', [req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map