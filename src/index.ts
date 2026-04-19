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
