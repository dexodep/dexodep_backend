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

// CORS - Allow frontend requests with detailed origin matching
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowedOrigins = [
            config.frontendUrl,
            'http://localhost:3000',
            'http://localhost:3001',
            'https://dexodep.vercel.app',
        ];

        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

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

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
    console.log(`\n🚀 DEXODEP backend running on port ${PORT}`);
    console.log(`📍 Frontend URL: ${config.frontendUrl}`);
    console.log(`🔐 Database: ${config.databaseUrl.substring(0, 50)}...`);
    console.log(`\nEndpoints available:`);
    console.log(`  GET  /api/health`);
    console.log(`  POST /api/auth/github`);
    console.log(`  GET  /api/servers`);
    console.log(`  GET  /api/services`);
    console.log(`\n`);
});

export default app;
