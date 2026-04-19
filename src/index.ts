import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './routes/auth';
import serverRoutes from './routes/servers';
import serviceRoutes from './routes/services';
import deploymentRoutes from './routes/deployments';
import webhookRoutes from './routes/webhooks';
import githubRoutes from './routes/github';

const app = express();

// CORS
app.use(cors({
    origin: config.frontendUrl,
    credentials: true,
}));

// Body parsing
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/github', githubRoutes);

// Start server
app.listen(config.port, () => {
    console.log(`DEXODEP backend running on http://localhost:${config.port}`);
});

export default app;
