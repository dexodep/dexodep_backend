import { Router, Request, Response } from 'express';
import db from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { runDeployment, deploymentEvents } from '../services/deploy';

const router = Router();

// POST /api/deployments/trigger/:serviceId → manually trigger deploy
router.post('/trigger/:serviceId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const serviceCheck = await db.query(
            'SELECT id FROM services WHERE id = $1 AND user_id = $2',
            [req.params.serviceId, req.userId]
        );
        if (serviceCheck.rows.length === 0) {
            res.status(404).json({ error: 'Service not found' });
            return;
        }

        const result = await db.query(
            `INSERT INTO deployments (service_id, status, triggered_by)
             VALUES ($1, 'queued', 'manual')
             RETURNING *`,
            [req.params.serviceId]
        );

        const deployment = result.rows[0];

        runDeployment(deployment.id, req.params.serviceId).catch((err) => {
            console.error('Background deployment error:', err);
        });

        res.status(201).json(deployment);
    } catch (error) {
        console.error('Trigger deployment error:', error);
        res.status(500).json({ error: 'Failed to trigger deployment' });
    }
});

// GET /api/deployments/:id → get deployment detail
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const result = await db.query(
            `SELECT d.*, s.name AS service_name, s.github_repo
             FROM deployments d
             JOIN services s ON d.service_id = s.id
             WHERE d.id = $1 AND s.user_id = $2`,
            [req.params.id, req.userId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Deployment not found' });
            return;
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get deployment error:', error);
        res.status(500).json({ error: 'Failed to get deployment' });
    }
});

// GET /api/deployments/:id/logs → SSE stream (real-time logs)
router.get('/:id/logs', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const deploymentId = req.params.id;

        // Verify user owns this deployment
        const result = await db.query(
            `SELECT d.id, d.status, d.phase, d.logs 
             FROM deployments d
             JOIN services s ON d.service_id = s.id
             WHERE d.id = $1 AND s.user_id = $2`,
            [deploymentId, req.userId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Deployment not found' });
            return;
        }

        const deployment = result.rows[0];

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // If deployment is already completed, send existing logs and status
        if (deployment.status === 'success' || deployment.status === 'failed') {
            if (deployment.logs) {
                const lines = deployment.logs.split('\n');
                for (const line of lines) {
                    res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
                }
            }
            res.write(`data: ${JSON.stringify({ type: 'status', status: deployment.status })}\n\n`);
            res.end();
            return;
        }

        // Send existing logs if any
        if (deployment.logs) {
            const lines = deployment.logs.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
                }
            }
        }

        // Listen for new log events
        const onLog = (data: { type: string; line?: string; status?: string }) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);

            if (data.type === 'status') {
                // Deployment finished, close connection
                cleanup();
                res.end();
            }
        };

        deploymentEvents.on(`log:${deploymentId}`, onLog);

        const cleanup = () => {
            deploymentEvents.removeListener(`log:${deploymentId}`, onLog);
        };

        // Handle client disconnect
        req.on('close', cleanup);
    } catch (error) {
        console.error('SSE logs error:', error);
        res.status(500).json({ error: 'Failed to stream logs' });
    }
});

export default router;
