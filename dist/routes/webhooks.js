"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const deploy_1 = require("../services/deploy");
const router = (0, express_1.Router)();
// POST /api/webhooks/github/:serviceId → receive GitHub push webhook
router.post('/github/:serviceId', async (req, res) => {
    try {
        const serviceId = req.params.serviceId;
        const signature = req.headers['x-hub-signature-256'];
        const event = req.headers['x-github-event'];
        if (event !== 'push') {
            res.status(200).json({ message: 'Event ignored' });
            return;
        }
        const serviceResult = await db_1.default.query('SELECT id, webhook_secret, branch, auto_deploy FROM services WHERE id = $1', [serviceId]);
        if (serviceResult.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }
        const service = serviceResult.rows[0];
        if (!service.auto_deploy) {
            res.status(200).json({ message: 'Auto-deploy disabled for this service' });
            return;
        }
        if (!signature) {
            res.status(401).json({ error: 'Missing signature' });
            return;
        }
        const body = JSON.stringify(req.body);
        const expectedSignature = 'sha256=' + crypto_1.default
            .createHmac('sha256', service.webhook_secret)
            .update(body, 'utf8')
            .digest('hex');
        const isValid = crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
        if (!isValid) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }
        const pushBranch = req.body.ref?.replace('refs/heads/', '');
        if (pushBranch !== service.branch) {
            res.status(200).json({ message: 'Push to non-configured branch, ignoring' });
            return;
        }
        const headCommit = req.body.head_commit;
        const commitSha = headCommit?.id || '';
        const commitMessage = headCommit?.message || '';
        const deployResult = await db_1.default.query(`INSERT INTO deployments (service_id, status, triggered_by, commit_sha, commit_message)
             VALUES ($1, 'queued', 'webhook', $2, $3)
             RETURNING *`, [serviceId, commitSha, commitMessage]);
        const deployment = deployResult.rows[0];
        (0, deploy_1.runDeployment)(deployment.id, serviceId, commitSha, commitMessage).catch((err) => {
            console.error('Webhook deployment error:', err);
        });
        res.status(200).json({ message: 'Deployment triggered', deployment_id: deployment.id });
    }
    catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
exports.default = router;
//# sourceMappingURL=webhooks.js.map