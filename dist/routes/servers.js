"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_ssh_1 = require("node-ssh");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/servers → list user's servers
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT id, name, host, username, status, os_info, created_at FROM servers WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('List servers error:', error);
        res.status(500).json({ error: 'Failed to list servers' });
    }
});
// POST /api/servers → add server
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, host, username, ssh_private_key } = req.body;
        if (!name || !host || !username || !ssh_private_key) {
            res.status(400).json({ error: 'Missing required fields: name, host, username, ssh_private_key' });
            return;
        }
        const result = await db_1.default.query(`INSERT INTO servers (user_id, name, host, username, ssh_private_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, host, username, created_at`, [req.userId, name, host, username, ssh_private_key]);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Add server error:', error);
        res.status(500).json({ error: 'Failed to add server' });
    }
});
// DELETE /api/servers/:id → delete server
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('DELETE FROM servers WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        res.json({ message: 'Server deleted' });
    }
    catch (error) {
        console.error('Delete server error:', error);
        res.status(500).json({ error: 'Failed to delete server' });
    }
});
// GET /api/servers/:id → get server details
router.get('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT id, name, host, username, status, os_info, created_at FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get server error:', error);
        res.status(500).json({ error: 'Failed to get server details' });
    }
});
// POST /api/servers/:id/test → test SSH connection
router.post('/:id/test', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        const server = result.rows[0];
        const ssh = new node_ssh_1.NodeSSH();
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 10000,
        });
        const uptime = await ssh.execCommand('uptime');
        const osInfo = await ssh.execCommand('cat /etc/os-release 2>/dev/null | head -2 || echo "Unknown OS"');
        ssh.dispose();
        // Update server status and os_info
        const osLine = osInfo.stdout.split('\n').find((l) => l.startsWith('PRETTY_NAME='));
        const osName = osLine ? osLine.replace('PRETTY_NAME=', '').replace(/"/g, '') : 'Linux';
        await db_1.default.query('UPDATE servers SET status = $1, os_info = $2 WHERE id = $3', ['active', JSON.stringify({ name: osName }), req.params.id]);
        res.json({
            success: true,
            message: `Connection successful. Uptime: ${uptime.stdout.trim()}`,
            os_info: osName,
        });
    }
    catch (error) {
        console.error('Test SSH connection error:', error);
        await db_1.default.query('UPDATE servers SET status = $1 WHERE id = $2', ['error', req.params.id]);
        res.json({
            success: false,
            message: `Connection failed: ${error.message || 'Unknown error'}`,
        });
    }
});
// POST /api/servers/:id/home-dir → detect home directory via SSH
router.post('/:id/home-dir', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        const server = result.rows[0];
        const ssh = new node_ssh_1.NodeSSH();
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 10000,
        });
        const homeResult = await ssh.execCommand('echo $HOME');
        ssh.dispose();
        const homeDir = homeResult.stdout.trim() || `/home/${server.username}`;
        res.json({ home_dir: homeDir });
    }
    catch (error) {
        res.status(500).json({ error: `Failed to detect: ${error.message}` });
    }
});
// GET /api/servers/:id/setup → SSE endpoint for full server provisioning
router.get('/:id/setup', async (req, res) => {
    // Auth via query param (SSE can't send headers)
    const token = req.query.token;
    if (!token) {
        res.status(401).json({ error: 'No token' });
        return;
    }
    let userId;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
        userId = decoded.userId;
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });
    const send = (type, data) => {
        if (clientDisconnected)
            return;
        try {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
        catch { /* ignore */ }
    };
    // Keep-alive ping every 15s to prevent proxy/browser timeouts
    const keepAlive = setInterval(() => {
        if (clientDisconnected) {
            clearInterval(keepAlive);
            return;
        }
        try {
            res.write(': keepalive\n\n');
        }
        catch { /* ignore */ }
    }, 15000);
    let ssh = null;
    try {
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        if (result.rows.length === 0) {
            send('log', { line: 'Server not found' });
            send('status', { status: 'failed' });
            res.end();
            return;
        }
        const server = result.rows[0];
        ssh = new node_ssh_1.NodeSSH();
        send('log', { line: '🔌 Connecting to server...' });
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 30000,
            keepaliveInterval: 10000,
        });
        send('log', { line: `✓ Connected to ${server.host}` });
        const steps = [
            { label: 'System Update', cmd: 'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y -qq' },
            { label: 'Essential Tools', cmd: 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl wget build-essential software-properties-common 2>/dev/null' },
            { label: 'NVM (Node Version Manager)', cmd: 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && echo "NVM already installed" || (curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash)' },
            { label: 'Node.js 20 LTS', cmd: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && (node -v 2>/dev/null | grep -q "v20" && echo "Node 20 already installed" || (nvm install 20 && nvm use 20 && nvm alias default 20))' },
            { label: 'PM2 Process Manager', cmd: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && (pm2 -v 2>/dev/null && echo "PM2 already installed" || npm install -g pm2)' },
            { label: 'Nginx Web Server', cmd: 'nginx -v 2>/dev/null && echo "Nginx already installed" || (sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx 2>/dev/null && sudo systemctl enable nginx && sudo systemctl start nginx)' },
            { label: 'Certbot (SSL/HTTPS)', cmd: 'certbot --version 2>/dev/null && echo "Certbot already installed" || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null' },
            { label: 'Firewall Rules', cmd: 'sudo ufw allow OpenSSH 2>/dev/null; sudo ufw allow "Nginx Full" 2>/dev/null; echo "y" | sudo ufw enable 2>/dev/null || true' },
        ];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            send('log', { line: `\n=== [${i + 1}/${steps.length}] ${step.label} ===` });
            send('progress', { current: i + 1, total: steps.length, label: step.label });
            if (clientDisconnected)
                break;
            const cmdResult = await ssh.execCommand(step.cmd, {
                onStdout(chunk) {
                    chunk.toString().split('\n').forEach((line) => {
                        if (line.trim())
                            send('log', { line });
                    });
                },
                onStderr(chunk) {
                    const text = chunk.toString();
                    if (/^[\s#%\d\.kMB]+$/.test(text) || text.includes('###'))
                        return;
                    text.split('\n').forEach((line) => {
                        const t = line.trim();
                        if (t && t.length > 2 && !t.match(/^[#%\s]+$/))
                            send('log', { line: `[stderr] ${t}` });
                    });
                },
            });
            if (cmdResult.code === 0 || cmdResult.code === null) {
                send('log', { line: `✓ ${step.label} — done` });
            }
            else {
                send('log', { line: `⚠ ${step.label} — exited with code ${cmdResult.code}` });
            }
        }
        // Verify installations
        send('log', { line: '\n=== Verifying Installations ===' });
        const checks = [
            { label: 'Git', cmd: 'git --version' },
            { label: 'Node.js', cmd: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && node -v' },
            { label: 'npm', cmd: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && npm -v' },
            { label: 'PM2', cmd: 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pm2 -v' },
            { label: 'Nginx', cmd: 'nginx -v 2>&1' },
            { label: 'Certbot', cmd: 'certbot --version 2>&1' },
        ];
        for (const check of checks) {
            const r = await ssh.execCommand(check.cmd);
            const ver = r.stdout.trim() || r.stderr.trim();
            send('log', { line: `  ${check.label}: ${ver || 'not found'}` });
        }
        await db_1.default.query('UPDATE servers SET status = $1, os_info = $2 WHERE id = $3', ['active', JSON.stringify({ name: 'Ubuntu', setup: 'complete' }), req.params.id]);
        ssh.dispose();
        ssh = null;
        clearInterval(keepAlive);
        send('log', { line: '\n✅ Server setup complete! Ready for deployments.' });
        send('status', { status: 'complete' });
        res.end();
    }
    catch (error) {
        clearInterval(keepAlive);
        send('log', { line: `\n❌ Setup failed: ${error.message}` });
        send('status', { status: 'failed' });
        if (ssh)
            ssh.dispose();
        res.end();
    }
});
// GET /api/servers/:id/commits → get git commit history
router.get('/:id/commits', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        const server = result.rows[0];
        const ssh = new node_ssh_1.NodeSSH();
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 10000,
        });
        // Get all services on this server to check their git repos
        const servicesResult = await db_1.default.query('SELECT root_dir FROM services WHERE server_id = $1', [req.params.id]);
        const allCommits = [];
        for (const service of servicesResult.rows) {
            try {
                const gitLog = await ssh.execCommand(`cd ${service.root_dir} && git log --oneline -10 --pretty=format:'{"hash":"%H","message":"%s","author":"%an","date":"%ai"}'`);
                if (gitLog.stdout) {
                    const lines = gitLog.stdout.trim().split('\n');
                    for (const line of lines) {
                        try {
                            const commit = JSON.parse(line);
                            commit.service = service.root_dir.split('/').pop();
                            allCommits.push(commit);
                        }
                        catch (e) {
                            // Skip malformed lines
                        }
                    }
                }
            }
            catch (error) {
                // Skip services without git repos
            }
        }
        ssh.dispose();
        // Sort by date descending and limit to 20
        allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        res.json(allCommits.slice(0, 20));
    }
    catch (error) {
        console.error('Get commits error:', error);
        res.status(500).json({ error: `Failed to get commits: ${error.message}` });
    }
});
// GET /api/servers/:id/logs → historical logs for the selected time range
router.get('/:id/logs', auth_1.authMiddleware, async (req, res) => {
    try {
        const range = req.query.range || '7d';
        const allowedRanges = {
            '7d': '7 days ago',
            '15d': '15 days ago',
            '30d': '30 days ago',
        };
        if (!allowedRanges[range]) {
            res.status(400).json({ error: 'Invalid log range' });
            return;
        }
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Server not found' });
            return;
        }
        const server = result.rows[0];
        const ssh = new node_ssh_1.NodeSSH();
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 10000,
        });
        const since = allowedRanges[range];
        let logs = [];
        try {
            const journalResult = await ssh.execCommand(`journalctl --since "${since}" --no-pager --output=short-iso 2>/dev/null | tail -200`);
            if (journalResult.stdout && journalResult.stdout.trim()) {
                logs = journalResult.stdout.trim().split('\n').filter(line => line.trim());
            }
        }
        catch (error) {
            // ignore and fallback
        }
        if (logs.length === 0) {
            const fallback = await ssh.execCommand(`tail -200 /var/log/syslog 2>/dev/null || tail -200 /var/log/messages 2>/dev/null || echo "No logs available"`);
            logs = fallback.stdout.trim().split('\n').filter(line => line.trim() && line !== 'No logs available');
        }
        ssh.dispose();
        res.json({ logs });
    }
    catch (error) {
        console.error('Get server logs error:', error);
        res.status(500).json({ error: `Failed to get server logs: ${error.message}` });
    }
});
// GET /api/servers/:id/monitor → SSE endpoint for real-time monitoring
router.get('/:id/monitor', async (req, res) => {
    // Auth via query param (SSE can't send headers)
    const token = req.query.token;
    if (!token) {
        res.status(401).json({ error: 'No token' });
        return;
    }
    let userId;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
        userId = decoded.userId;
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });
    const send = (type, data) => {
        if (clientDisconnected)
            return;
        try {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
        catch { /* ignore */ }
    };
    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
        if (clientDisconnected) {
            clearInterval(keepAlive);
            return;
        }
        try {
            res.write(': keepalive\n\n');
        }
        catch { /* ignore */ }
    }, 15000);
    let ssh = null;
    try {
        const result = await db_1.default.query('SELECT * FROM servers WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        if (result.rows.length === 0) {
            send('log', { line: 'Server not found' });
            res.end();
            return;
        }
        const server = result.rows[0];
        ssh = new node_ssh_1.NodeSSH();
        send('log', { line: `🔌 Connected to ${server.host} - Starting monitoring...` });
        await ssh.connect({
            host: server.host,
            username: server.username,
            privateKey: server.ssh_private_key,
            readyTimeout: 30000,
            keepaliveInterval: 10000,
        });
        // Monitor loop - collect metrics and logs every 5 seconds
        const monitorInterval = setInterval(async () => {
            if (clientDisconnected) {
                clearInterval(monitorInterval);
                return;
            }
            try {
                // Get CPU usage
                const cpuResult = await ssh.execCommand('top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'');
                const cpuUsage = parseFloat(cpuResult.stdout.trim()) || 0;
                // Get memory usage
                const memResult = await ssh.execCommand('free -b | grep Mem');
                const memParts = memResult.stdout.trim().split(/\s+/);
                const memTotal = parseInt(memParts[1]) || 0;
                const memUsed = parseInt(memParts[2]) || 0;
                const memPercentage = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
                // Get uptime
                const uptimeResult = await ssh.execCommand('uptime -p');
                const uptime = uptimeResult.stdout.trim() || 'unknown';
                // Get load average
                const loadResult = await ssh.execCommand('uptime | awk -F\'load average:\' \'{ print $2 }\' | sed \'s/,//g\'');
                const loadAvg = loadResult.stdout.trim().split(/\s+/).map(parseFloat) || [0, 0, 0];
                const metrics = {
                    cpu: cpuUsage,
                    memory: {
                        used: memUsed,
                        total: memTotal,
                        percentage: memPercentage
                    },
                    uptime: uptime,
                    load_average: loadAvg
                };
                send('metrics', { metrics });
                // Get recent system logs (last 5 lines from syslog)
                const logResult = await ssh.execCommand('tail -5 /var/log/syslog 2>/dev/null || tail -5 /var/log/messages 2>/dev/null || echo "No system logs available"');
                const logs = logResult.stdout.trim().split('\n').filter(line => line.trim());
                for (const log of logs) {
                    if (log && log !== "No system logs available") {
                        send('log', { line: `[SYS] ${log}` });
                    }
                }
                // Check PM2 processes if available
                try {
                    const pm2Result = await ssh.execCommand('pm2 jlist 2>/dev/null | head -20');
                    if (pm2Result.stdout) {
                        const pm2Data = JSON.parse(pm2Result.stdout);
                        for (const proc of pm2Data.slice(0, 3)) { // Show first 3 processes
                            if (proc && proc.name && proc.pm2_env && proc.pm2_env.status) {
                                send('log', { line: `[PM2] ${proc.name}: ${proc.pm2_env.status} (CPU: ${proc.monit.cpu}%, MEM: ${(proc.monit.memory / 1024 / 1024).toFixed(1)}MB)` });
                            }
                        }
                    }
                }
                catch (e) {
                    // PM2 not available or no processes
                }
            }
            catch (error) {
                send('log', { line: `[ERROR] Failed to collect metrics: ${error.message}` });
            }
        }, 5000); // Update every 5 seconds
        // Cleanup on disconnect
        req.on('close', () => {
            clearInterval(monitorInterval);
            clearInterval(keepAlive);
            if (ssh)
                ssh.dispose();
        });
    }
    catch (error) {
        clearInterval(keepAlive);
        send('log', { line: `❌ Monitoring failed: ${error.message}` });
        if (ssh)
            ssh.dispose();
        res.end();
    }
});
exports.default = router;
//# sourceMappingURL=servers.js.map