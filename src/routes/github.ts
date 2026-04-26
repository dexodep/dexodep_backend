import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { detectFromGitHub } from '../services/detector';
const router = Router();

// GET /api/github/repos → fetch user's GitHub repos
router.get('/repos', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const userResult = await db.query(
            'SELECT access_token FROM users WHERE id = $1',
            [req.userId]
        );

        if (userResult.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const accessToken = userResult.rows[0].access_token;

        const response = await fetch(
            'https://api.github.com/user/repos?sort=updated&direction=desc&per_page=50&type=all',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            }
        );

        if (!response.ok) {
            res.status(502).json({ error: 'Failed to fetch repos from GitHub' });
            return;
        }

        const repos = await response.json() as Array<{
            id: number;
            name: string;
            full_name: string;
            private: boolean;
            updated_at: string;
            default_branch: string;
        }>;

        const simplified = repos.map((r) => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            updated_at: r.updated_at,
            default_branch: r.default_branch,
        }));

        res.json(simplified);
    } catch (error) {
        console.error('Fetch GitHub repos error:', error);
        res.status(500).json({ error: 'Failed to fetch repos' });
    }
});

// POST /api/github/detect → auto-detect runtime from repo
router.post('/detect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { repo, branch } = req.body;
        if (!repo) {
            res.status(400).json({ error: 'Missing repo field' });
            return;
        }

        const userResult = await db.query(
            'SELECT access_token FROM users WHERE id = $1',
            [req.userId]
        );
        if (userResult.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const accessToken = userResult.rows[0].access_token;
        const detected = await detectFromGitHub(accessToken, repo, branch || 'main');
        res.json(detected);
    } catch (error) {
        console.error('Detect runtime error:', error);
        res.status(500).json({ error: 'Failed to detect runtime' });
    }
});

export default router;
