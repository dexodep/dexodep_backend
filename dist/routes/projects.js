"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// GET /api/projects → list projects with latest deployment status
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query(`SELECT p.*, 
        d.status AS last_deploy_status, 
        d.created_at AS last_deploy_at,
        s.name AS server_name
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT status, created_at FROM deployments 
         WHERE project_id = p.id 
         ORDER BY created_at DESC LIMIT 1
       ) d ON true
       LEFT JOIN servers s ON p.server_id = s.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`, [req.userId]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});
// POST /api/projects → create project
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, server_id, github_repo, branch, root_dir, build_command, start_command, app_port, env_vars, domain, } = req.body;
        if (!name || !server_id || !github_repo || !start_command) {
            res.status(400).json({ error: 'Missing required fields: name, server_id, github_repo, start_command' });
            return;
        }
        // Verify server belongs to user
        const serverCheck = await db_1.default.query('SELECT id FROM servers WHERE id = $1 AND user_id = $2', [server_id, req.userId]);
        if (serverCheck.rows.length === 0) {
            res.status(400).json({ error: 'Server not found or does not belong to you' });
            return;
        }
        const webhookSecret = crypto_1.default.randomBytes(32).toString('hex');
        const result = await db_1.default.query(`INSERT INTO projects (user_id, server_id, name, github_repo, branch, root_dir, build_command, start_command, app_port, env_vars, domain, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`, [
            req.userId, server_id, name, github_repo,
            branch || 'main', root_dir || '/var/www/app',
            build_command || '', start_command,
            app_port || 3000, JSON.stringify(env_vars || {}),
            domain || '',
            webhookSecret,
        ]);
        const project = result.rows[0];
        const webhookUrl = `${config_1.config.github.callbackUrl.replace('/api/auth/github/callback', '')}/api/webhooks/github/${project.id}`;
        res.status(201).json({ ...project, webhook_url: webhookUrl });
    }
    catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});
// GET /api/projects/:id → project detail
router.get('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query(`SELECT p.*, s.name AS server_name, s.host AS server_host
       FROM projects p
       LEFT JOIN servers s ON p.server_id = s.id
       WHERE p.id = $1 AND p.user_id = $2`, [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Failed to get project' });
    }
});
// PUT /api/projects/:id → update project
router.put('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, server_id, github_repo, branch, root_dir, build_command, start_command, app_port, env_vars, domain, } = req.body;
        // Verify project belongs to user
        const existing = await db_1.default.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (existing.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        // If server_id is provided, verify it belongs to user
        if (server_id) {
            const serverCheck = await db_1.default.query('SELECT id FROM servers WHERE id = $1 AND user_id = $2', [server_id, req.userId]);
            if (serverCheck.rows.length === 0) {
                res.status(400).json({ error: 'Server not found or does not belong to you' });
                return;
            }
        }
        const result = await db_1.default.query(`UPDATE projects SET
        name = COALESCE($1, name),
        server_id = COALESCE($2, server_id),
        github_repo = COALESCE($3, github_repo),
        branch = COALESCE($4, branch),
        root_dir = COALESCE($5, root_dir),
        build_command = COALESCE($6, build_command),
        start_command = COALESCE($7, start_command),
        app_port = COALESCE($8, app_port),
        env_vars = COALESCE($9, env_vars),
        domain = COALESCE($10, domain)
       WHERE id = $11 AND user_id = $12
       RETURNING *`, [
            name, server_id, github_repo, branch, root_dir,
            build_command, start_command, app_port,
            env_vars ? JSON.stringify(env_vars) : null,
            domain !== undefined ? domain : null,
            req.params.id, req.userId,
        ]);
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});
// DELETE /api/projects/:id → delete project
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json({ message: 'Project deleted' });
    }
    catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});
// GET /api/projects/:id/deployments → last 20 deployments
router.get('/:id/deployments', auth_1.authMiddleware, async (req, res) => {
    try {
        // Verify project belongs to user
        const projectCheck = await db_1.default.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (projectCheck.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        const result = await db_1.default.query(`SELECT id, status, triggered_by, commit_sha, commit_message, created_at
       FROM deployments
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 20`, [req.params.id]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('List deployments error:', error);
        res.status(500).json({ error: 'Failed to list deployments' });
    }
});
exports.default = router;
//# sourceMappingURL=projects.js.map