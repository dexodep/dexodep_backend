"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const auth_1 = __importDefault(require("./routes/auth"));
const servers_1 = __importDefault(require("./routes/servers"));
const services_1 = __importDefault(require("./routes/services"));
const deployments_1 = __importDefault(require("./routes/deployments"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const github_1 = __importDefault(require("./routes/github"));
const app = (0, express_1.default)();
// CORS - Allow frontend requests with detailed origin matching
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            config_1.config.frontendUrl,
            'http://localhost:3000',
            'http://localhost:3001',
            'https://dexodep.vercel.app',
        ];
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
            callback(null, true);
        }
        else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use((0, cors_1.default)(corsOptions));
// Body parsing
app.use(express_1.default.json());
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
app.use('/api/auth', auth_1.default);
app.use('/api/servers', servers_1.default);
app.use('/api/services', services_1.default);
app.use('/api/deployments', deployments_1.default);
app.use('/api/webhooks', webhooks_1.default);
app.use('/api/github', github_1.default);
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});
// Start server
const PORT = config_1.config.port;
app.listen(PORT, () => {
    console.log(`\n🚀 DEXODEP backend running on port ${PORT}`);
    console.log(`📍 Frontend URL: ${config_1.config.frontendUrl}`);
    console.log(`🔐 Database: ${config_1.config.databaseUrl.substring(0, 50)}...`);
    console.log(`\nEndpoints available:`);
    console.log(`  GET  /api/health`);
    console.log(`  POST /api/auth/github`);
    console.log(`  GET  /api/servers`);
    console.log(`  GET  /api/services`);
    console.log(`\n`);
});
exports.default = app;
//# sourceMappingURL=index.js.map