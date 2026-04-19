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
// GET /api/services → list services with latest deployment status
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query(`SELECT s.*,
                d.status AS last_deploy_status,
                d.created_at AS last_deploy_at,
                sv.name AS server_name
             FROM services s
             LEFT JOIN LATERAL (
                 SELECT status, created_at FROM deployments
                 WHERE service_id = s.id
                 ORDER BY created_at DESC LIMIT 1
             ) d ON true
             LEFT JOIN servers sv ON s.server_id = sv.id
             WHERE s.user_id = $1
             ORDER BY s.updated_at DESC`, [req.userId]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('List services error:', error);
        res.status(500).json({ error: 'Failed to list services' });
    }
});
// POST /api/services → create service
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, type, server_id, github_repo, branch, root_dir, build_command, start_command, app_port, env_vars, domain, runtime, runtime_version, auto_deploy, health_check_path, } = req.body;
        if (!name || !server_id || !github_repo || !start_command || !type) {
            res.status(400).json({ error: 'Missing required fields: name, type, server_id, github_repo, start_command' });
            return;
        }
        const validTypes = ['web_service', 'static_site', 'background_worker', 'cron_job'];
        if (!validTypes.includes(type)) {
            res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
            return;
        }
        // Verify server belongs to user
        const serverCheck = await db_1.default.query('SELECT id FROM servers WHERE id = $1 AND user_id = $2', [server_id, req.userId]);
        if (serverCheck.rows.length === 0) {
            res.status(400).json({ error: 'Server not found or does not belong to you' });
            return;
        }
        const webhookSecret = crypto_1.default.randomBytes(32).toString('hex');
        const result = await db_1.default.query(`INSERT INTO services (user_id, server_id, name, type, github_repo, branch, root_dir,
                build_command, start_command, app_port, env_vars, domain, webhook_secret,
                runtime, runtime_version, auto_deploy, health_check_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             RETURNING *`, [
            req.userId, server_id, name, type, github_repo,
            branch || 'main', root_dir || `/home/ubuntu/${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            build_command || '', start_command,
            app_port || 3000, JSON.stringify(env_vars || {}),
            domain || '', webhookSecret,
            runtime || 'node', runtime_version || '',
            auto_deploy !== false, health_check_path || '/',
        ]);
        const service = result.rows[0];
        // Create domain record if domain is provided
        if (domain && domain.trim()) {
            await db_1.default.query(`INSERT INTO domains (service_id, domain) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [service.id, domain.trim()]);
        }
        const webhookUrl = `${config_1.config.github.callbackUrl.replace('/api/auth/github/callback', '')}/api/webhooks/github/${service.id}`;
        res.status(201).json({ ...service, webhook_url: webhookUrl });
    }
    catch (error) {
        console.error('Create service error:', error);
        res.status(500).json({ error: 'Failed to create service' });
    }
});
// GET /api/services/:id → service detail
router.get('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query(`SELECT s.*, sv.name AS server_name, sv.host AS server_host
             FROM services s
             LEFT JOIN servers sv ON s.server_id = sv.id
             WHERE s.id = $1 AND s.user_id = $2`, [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get service error:', error);
        res.status(500).json({ error: 'Failed to get service' });
    }
});
// PUT /api/services/:id → update service
router.put('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, server_id, github_repo, branch, root_dir, build_command, start_command, app_port, env_vars, domain, runtime, runtime_version, auto_deploy, health_check_path, } = req.body;
        const existing = await db_1.default.query('SELECT id FROM services WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (existing.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }
        if (server_id) {
            const serverCheck = await db_1.default.query('SELECT id FROM servers WHERE id = $1 AND user_id = $2', [server_id, req.userId]);
            if (serverCheck.rows.length === 0) {
                res.status(400).json({ error: 'Server not found or does not belong to you' });
                return;
            }
        }
        const result = await db_1.default.query(`UPDATE services SET
                name = COALESCE($1, name),
                server_id = COALESCE($2, server_id),
                github_repo = COALESCE($3, github_repo),
                branch = COALESCE($4, branch),
                root_dir = COALESCE($5, root_dir),
                build_command = COALESCE($6, build_command),
                start_command = COALESCE($7, start_command),
                app_port = COALESCE($8, app_port),
                env_vars = COALESCE($9, env_vars),
                domain = COALESCE($10, domain),
                runtime = COALESCE($11, runtime),
                runtime_version = COALESCE($12, runtime_version),
                auto_deploy = COALESCE($13, auto_deploy),
                health_check_path = COALESCE($14, health_check_path),
                updated_at = NOW()
             WHERE id = $15 AND user_id = $16
             RETURNING *`, [
            name, server_id, github_repo, branch, root_dir,
            build_command, start_command, app_port,
            env_vars ? JSON.stringify(env_vars) : null,
            domain !== undefined ? domain : null,
            runtime, runtime_version,
            auto_deploy !== undefined ? auto_deploy : null,
            health_check_path !== undefined ? health_check_path : null,
            req.params.id, req.userId,
        ]);
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ error: 'Failed to update service' });
    }
});
// DELETE /api/services/:id → delete service
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('DELETE FROM services WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }
        res.json({ message: 'Service deleted' });
    }
    catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ error: 'Failed to delete service' });
    }
});
// GET /api/services/:id/deployments → last 20 deployments for a service
router.get('/:id/deployments', auth_1.authMiddleware, async (req, res) => {
    try {
        const serviceCheck = await db_1.default.query('SELECT id FROM services WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (serviceCheck.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }
        const result = await db_1.default.query(`SELECT id, status, phase, triggered_by, commit_sha, commit_message, duration_ms, created_at, finished_at
             FROM deployments
             WHERE service_id = $1
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
//# sourceMappingURL=services.js.map