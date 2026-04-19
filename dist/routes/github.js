"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const detector_1 = require("../services/detector");
const router = (0, express_1.Router)();
// GET /api/github/repos → fetch user's GitHub repos
router.get('/repos', auth_1.authMiddleware, async (req, res) => {
    try {
        const userResult = await db_1.default.query('SELECT access_token FROM users WHERE id = $1', [req.userId]);
        if (userResult.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const accessToken = userResult.rows[0].access_token;
        const response = await fetch('https://api.github.com/user/repos?sort=updated&direction=desc&per_page=50&type=all', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        if (!response.ok) {
            res.status(502).json({ error: 'Failed to fetch repos from GitHub' });
            return;
        }
        const repos = await response.json();
        const simplified = repos.map((r) => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            updated_at: r.updated_at,
            default_branch: r.default_branch,
        }));
        res.json(simplified);
    }
    catch (error) {
        console.error('Fetch GitHub repos error:', error);
        res.status(500).json({ error: 'Failed to fetch repos' });
    }
});
// POST /api/github/detect → auto-detect runtime from repo
router.post('/detect', auth_1.authMiddleware, async (req, res) => {
    try {
        const { repo, branch } = req.body;
        if (!repo) {
            res.status(400).json({ error: 'Missing repo field' });
            return;
        }
        const userResult = await db_1.default.query('SELECT access_token FROM users WHERE id = $1', [req.userId]);
        if (userResult.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const accessToken = userResult.rows[0].access_token;
        const detected = await (0, detector_1.detectFromGitHub)(accessToken, repo, branch || 'main');
        res.json(detected);
    }
    catch (error) {
        console.error('Detect runtime error:', error);
        res.status(500).json({ error: 'Failed to detect runtime' });
    }
});
exports.default = router;
//# sourceMappingURL=github.js.map