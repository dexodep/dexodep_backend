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
// CORS
app.use((0, cors_1.default)({
    origin: config_1.config.frontendUrl,
    credentials: true,
}));
// Body parsing
app.use(express_1.default.json());
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
// Start server
app.listen(config_1.config.port, () => {
    console.log(`DEXODEP backend running on http://localhost:${config_1.config.port}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map