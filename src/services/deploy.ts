import { EventEmitter } from 'events';
import { NodeSSH } from 'node-ssh';
import db from '../db';
import { getRuntimeInstallSteps, usesSystemd, generateSystemdUnit, generateNginxConfig } from './runtime';

export const deploymentEvents = new EventEmitter();
deploymentEvents.setMaxListeners(100);

interface ServiceWithServer {
    id: string;
    name: string;
    type: string;
    github_repo: string;
    branch: string;
    runtime: string;
    runtime_version: string;
    root_dir: string;
    build_command: string;
    start_command: string;
    app_port: number;
    domain: string;
    env_vars: Record<string, string>;
    auto_deploy: boolean;
    health_check_path: string;
    server_host: string;
    server_username: string;
    server_ssh_private_key: string;
}

function emitLog(deploymentId: string, line: string): void {
    deploymentEvents.emit(`log:${deploymentId}`, { type: 'log', line });
}

function emitPhase(deploymentId: string, phase: string): void {
    deploymentEvents.emit(`log:${deploymentId}`, { type: 'phase', phase });
}

function emitStatus(deploymentId: string, status: string): void {
    deploymentEvents.emit(`log:${deploymentId}`, { type: 'status', status });
}

async function runCmd(
    ssh: NodeSSH,
    command: string,
    deploymentId: string,
    allLogs: string[],
    allowFail = false,
    silent = false
): Promise<{ success: boolean; stdout: string }> {
    if (!silent) {
        emitLog(deploymentId, `$ ${command}`);
        allLogs.push(`$ ${command}`);
    }
    let fullStdout = '';

    try {
        const wrappedCmd = `export NVM_DIR="$HOME/.nvm" 2>/dev/null; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null; [ -s "$HOME/.cargo/env" ] && . "$HOME/.cargo/env" 2>/dev/null; export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin 2>/dev/null; ${command}`;

        const result = await ssh.execCommand(wrappedCmd, {
            onStdout(chunk) {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        if (!silent) {
                            emitLog(deploymentId, line);
                            allLogs.push(line);
                        }
                        fullStdout += line + '\n';
                    }
                }
            },
            onStderr(chunk) {
                if (silent) return;
                const text = chunk.toString();
                // Filter out noisy download progress bars
                if (/^[\s#%\d\.kMB]+$/.test(text) || text.includes('###') || /^\s*\d+\.\d+%/.test(text.trim())) return;
                const lines = text.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && trimmed.length > 2 && !trimmed.match(/^[#%\s]+$/)) {
                        emitLog(deploymentId, `[stderr] ${trimmed}`);
                        allLogs.push(`[stderr] ${trimmed}`);
                    }
                }
            },
        });

        if (result.code !== 0 && result.code !== null) {
            if (!allowFail) {
                const errMsg = `Command exited with code ${result.code}`;
                emitLog(deploymentId, errMsg);
                allLogs.push(errMsg);
            }
            return { success: false, stdout: fullStdout };
        }
        return { success: true, stdout: fullStdout };
    } catch (error: any) {
        if (!allowFail) {
            const errMsg = `Command error: ${error.message}`;
            emitLog(deploymentId, errMsg);
            allLogs.push(errMsg);
        }
        return { success: false, stdout: fullStdout };
    }
}

async function setPhase(deploymentId: string, phase: string, allLogs: string[]): Promise<void> {
    await db.query('UPDATE deployments SET phase = $1 WHERE id = $2', [phase, deploymentId]);
    const header = `\n=== ${phase} ===`;
    emitLog(deploymentId, header);
    emitPhase(deploymentId, phase);
    allLogs.push(header);
}

export async function runDeployment(
    deploymentId: string,
    serviceId: string,
    commitSha?: string,
    commitMessage?: string
): Promise<void> {
    const allLogs: string[] = [];
    let ssh: NodeSSH | null = null;
    const startTime = Date.now();

    try {
        const svcResult = await db.query(
            `SELECT s.*, sv.host AS server_host, sv.username AS server_username, sv.ssh_private_key AS server_ssh_private_key,
                    u.access_token AS github_token
             FROM services s
             JOIN servers sv ON s.server_id = sv.id
             JOIN users u ON s.user_id = u.id
             WHERE s.id = $1`,
            [serviceId]
        );

        if (svcResult.rows.length === 0) throw new Error('Service not found');

        const svc: ServiceWithServer & { github_token: string } = svcResult.rows[0];
        const gitUrl = `https://x-access-token:${svc.github_token}@github.com/${svc.github_repo}.git`;
        const pm2Name = svc.name.replace(/[^a-zA-Z0-9_-]/g, '-');
        const useSystemd = usesSystemd(svc.runtime);

        await db.query(
            `UPDATE deployments SET status = 'running', commit_sha = $2, commit_message = $3 WHERE id = $1`,
            [deploymentId, commitSha || null, commitMessage || null]
        );
        await db.query(`UPDATE services SET status = 'deploying' WHERE id = $1`, [serviceId]);

        emitLog(deploymentId, '🚀 Starting deployment...');
        allLogs.push('🚀 Starting deployment...');
        emitLog(deploymentId, `Runtime: ${svc.runtime} | Type: ${svc.type} | Branch: ${svc.branch}`);
        allLogs.push(`Runtime: ${svc.runtime} | Type: ${svc.type} | Branch: ${svc.branch}`);

        emitLog(deploymentId, `Connecting to ${svc.server_host}...`);
        allLogs.push(`Connecting to ${svc.server_host}...`);

        ssh = new NodeSSH();
        await ssh.connect({
            host: svc.server_host,
            username: svc.server_username,
            privateKey: svc.server_ssh_private_key,
            readyTimeout: 20000,
        });

        emitLog(deploymentId, '✓ Connected to server');
        allLogs.push('✓ Connected to server');

        // PHASE 1: Server Setup
        await setPhase(deploymentId, 'PHASE 1: Server Setup', allLogs);

        const installSteps = getRuntimeInstallSteps(svc.runtime);
        for (const step of installSteps) {
            emitLog(deploymentId, `Checking ${step.label}...`);
            allLogs.push(`Checking ${step.label}...`);
            const check = await runCmd(ssh, step.check, deploymentId, allLogs, true);
            if (check.success) {
                emitLog(deploymentId, `✓ ${step.label} is installed`);
                allLogs.push(`✓ ${step.label} is installed`);
            } else {
                emitLog(deploymentId, `Installing ${step.label}...`);
                allLogs.push(`Installing ${step.label}...`);
                const install = await runCmd(ssh, step.install, deploymentId, allLogs);
                if (!install.success) throw new Error(`Failed to install ${step.label}`);
                emitLog(deploymentId, `✓ ${step.label} installed`);
                allLogs.push(`✓ ${step.label} installed`);
            }
        }

        // PHASE 2: App Setup
        await setPhase(deploymentId, 'PHASE 2: App Setup', allLogs);

        const dirCheck = await runCmd(ssh, `test -d ${svc.root_dir}/.git && echo "EXISTS"`, deploymentId, allLogs, true);
        if (!dirCheck.stdout.includes('EXISTS')) {
            emitLog(deploymentId, 'Cloning repository...');
            allLogs.push('Cloning repository...');
            const clone = await runCmd(ssh, `git clone ${gitUrl} ${svc.root_dir}`, deploymentId, allLogs);
            if (!clone.success) throw new Error('Failed to clone repository');
        } else {
            emitLog(deploymentId, 'Pulling latest changes...');
            allLogs.push('Pulling latest changes...');
            await runCmd(ssh, `cd ${svc.root_dir} && git remote set-url origin ${gitUrl}`, deploymentId, allLogs, true);
            const pull = await runCmd(ssh, `cd ${svc.root_dir} && git fetch origin && git reset --hard origin/${svc.branch}`, deploymentId, allLogs);
            if (!pull.success) throw new Error('Failed to pull latest changes');
        }

        // Write .env
        if (svc.env_vars && typeof svc.env_vars === 'object') {
            const entries = Object.entries(svc.env_vars);
            if (entries.length > 0) {
                emitLog(deploymentId, `Writing .env file (${entries.length} variables)...`);
                allLogs.push(`Writing .env file (${entries.length} variables)...`);
                const envLines = entries.map(([k, v]) => `${k}=${v}`);
                await runCmd(ssh, `cat > ${svc.root_dir}/.env << 'DEXODEP_ENV_EOF'\n${envLines.join('\n')}\nDEXODEP_ENV_EOF`, deploymentId, allLogs, false, true);
                emitLog(deploymentId, '✓ .env file written');
                allLogs.push('✓ .env file written');
            }
        }

        // Install dependencies
        if (['node', 'bun'].includes(svc.runtime)) {
            const installCmd = svc.runtime === 'bun' ? 'bun install' : 'npm install';
            emitLog(deploymentId, `Installing dependencies: ${installCmd}`);
            allLogs.push(`Installing dependencies: ${installCmd}`);
            const install = await runCmd(ssh, `cd ${svc.root_dir} && ${installCmd}`, deploymentId, allLogs);
            if (!install.success) throw new Error('Dependency installation failed');
            emitLog(deploymentId, '✓ Dependencies installed');
            allLogs.push('✓ Dependencies installed');
        } else if (svc.runtime === 'python') {
            const hasReqs = await runCmd(ssh, `test -f ${svc.root_dir}/requirements.txt && echo "YES"`, deploymentId, allLogs, true);
            if (hasReqs.stdout.includes('YES')) {
                emitLog(deploymentId, 'Installing dependencies: pip install');
                allLogs.push('Installing dependencies: pip install');
                const install = await runCmd(ssh, `cd ${svc.root_dir} && pip3 install -r requirements.txt`, deploymentId, allLogs);
                if (!install.success) throw new Error('Dependency installation failed');
                emitLog(deploymentId, '✓ Dependencies installed');
                allLogs.push('✓ Dependencies installed');
            }
        }

        // Build
        if (svc.build_command && svc.build_command.trim()) {
            emitLog(deploymentId, `Running build: ${svc.build_command}`);
            allLogs.push(`Running build: ${svc.build_command}`);
            const build = await runCmd(ssh, `cd ${svc.root_dir} && ${svc.build_command}`, deploymentId, allLogs);
            if (!build.success) throw new Error('Build command failed');
            emitLog(deploymentId, '✓ Build completed');
            allLogs.push('✓ Build completed');
        }

        // PHASE 3: Process Manager
        await setPhase(deploymentId, 'PHASE 3: Process Manager', allLogs);

        if (useSystemd) {
            emitLog(deploymentId, `Configuring systemd: ${pm2Name}`);
            allLogs.push(`Configuring systemd: ${pm2Name}`);

            const unit = generateSystemdUnit(pm2Name, svc.root_dir, svc.start_command, svc.app_port, svc.env_vars || {});
            const escapedUnit = unit.replace(/'/g, "'\\''");
            await runCmd(ssh, `echo '${escapedUnit}' | sudo tee /etc/systemd/system/${pm2Name}.service`, deploymentId, allLogs);
            await runCmd(ssh, 'sudo systemctl daemon-reload', deploymentId, allLogs);
            await runCmd(ssh, `sudo systemctl enable ${pm2Name}`, deploymentId, allLogs);
            await runCmd(ssh, `sudo systemctl restart ${pm2Name}`, deploymentId, allLogs);
            emitLog(deploymentId, `✓ ${pm2Name} started via systemd`);
            allLogs.push(`✓ ${pm2Name} started via systemd`);
        } else {
            const pm2Check = await runCmd(ssh, `pm2 describe ${pm2Name}`, deploymentId, allLogs, true);

            if (pm2Check.success) {
                emitLog(deploymentId, `Restarting PM2: ${pm2Name}`);
                allLogs.push(`Restarting PM2: ${pm2Name}`);
                await runCmd(ssh, `pm2 restart ${pm2Name}`, deploymentId, allLogs);
            } else {
                emitLog(deploymentId, `Starting PM2: ${pm2Name}`);
                allLogs.push(`Starting PM2: ${pm2Name}`);

                let interpreter = '';
                if (svc.runtime === 'python') interpreter = '--interpreter python3';
                if (svc.runtime === 'ruby') interpreter = '--interpreter ruby';

                const startResult = await runCmd(
                    ssh,
                    `cd ${svc.root_dir} && PORT=${svc.app_port} pm2 start ${svc.start_command} --name ${pm2Name} ${interpreter}`,
                    deploymentId,
                    allLogs
                );
                if (!startResult.success) throw new Error('PM2 start failed');
            }

            await runCmd(ssh, 'pm2 save', deploymentId, allLogs);
            emitLog(deploymentId, `✓ ${pm2Name} managed by PM2`);
            allLogs.push(`✓ ${pm2Name} managed by PM2`);
        }

        // PHASE 4: Nginx
        if (svc.domain && svc.domain.trim()) {
            await setPhase(deploymentId, 'PHASE 4: Nginx Configuration', allLogs);

            const nginxConfig = generateNginxConfig(svc.domain, svc.app_port);
            const escapedConfig = nginxConfig.replace(/'/g, "'\\''");

            emitLog(deploymentId, `Configuring Nginx for ${svc.domain}...`);
            allLogs.push(`Configuring Nginx for ${svc.domain}...`);

            await runCmd(ssh, `echo '${escapedConfig}' | sudo tee /etc/nginx/sites-available/${pm2Name}`, deploymentId, allLogs);
            await runCmd(ssh, `sudo ln -sf /etc/nginx/sites-available/${pm2Name} /etc/nginx/sites-enabled/`, deploymentId, allLogs);

            const nginxTest = await runCmd(ssh, 'sudo nginx -t', deploymentId, allLogs);
            if (!nginxTest.success) throw new Error('Nginx configuration test failed');

            await runCmd(ssh, 'sudo nginx -s reload', deploymentId, allLogs);
            emitLog(deploymentId, `✓ Nginx configured for ${svc.domain}`);
            allLogs.push(`✓ Nginx configured for ${svc.domain}`);

            // PHASE 5: SSL
            await setPhase(deploymentId, 'PHASE 5: SSL Certificate', allLogs);
            emitLog(deploymentId, `Requesting SSL for ${svc.domain}...`);
            allLogs.push(`Requesting SSL for ${svc.domain}...`);

            const sslResult = await runCmd(
                ssh,
                `sudo certbot --nginx -d ${svc.domain} --non-interactive --agree-tos -m admin@${svc.domain}`,
                deploymentId,
                allLogs,
                true
            );

            if (sslResult.success) {
                emitLog(deploymentId, '✓ SSL certificate installed');
                allLogs.push('✓ SSL certificate installed');
                await db.query(`UPDATE domains SET ssl_status = 'active' WHERE service_id = $1 AND domain = $2`, [serviceId, svc.domain]);
            } else {
                emitLog(deploymentId, '⚠ SSL setup failed — continuing without SSL');
                allLogs.push('⚠ SSL setup failed — continuing without SSL');
            }
        } else {
            emitLog(deploymentId, 'No domain configured — skipping Nginx & SSL');
            allLogs.push('No domain configured — skipping Nginx & SSL');
        }

        // PHASE 6: Health Check
        await setPhase(deploymentId, 'PHASE 6: Health Check', allLogs);

        emitLog(deploymentId, 'Waiting for app to start...');
        allLogs.push('Waiting for app to start...');
        await new Promise((r) => setTimeout(r, 3000));

        const healthPath = svc.health_check_path || '/';
        const healthCheck = await runCmd(
            ssh,
            `curl -sf -o /dev/null -w "%{http_code}" http://localhost:${svc.app_port}${healthPath} || echo "UNREACHABLE"`,
            deploymentId,
            allLogs,
            true
        );

        const output = healthCheck.stdout.trim();
        if (healthCheck.success && !output.includes('UNREACHABLE')) {
            emitLog(deploymentId, `✓ App responding on port ${svc.app_port} (HTTP ${output})`);
            allLogs.push(`✓ App responding on port ${svc.app_port} (HTTP ${output})`);
        } else {
            emitLog(deploymentId, `⚠ App not responding on port ${svc.app_port} — may still be starting`);
            allLogs.push(`⚠ App not responding on port ${svc.app_port} — may still be starting`);
        }

        // Success
        const durationMs = Date.now() - startTime;
        emitLog(deploymentId, `\n✅ Deployment completed in ${Math.round(durationMs / 1000)}s!`);
        allLogs.push(`\n✅ Deployment completed in ${Math.round(durationMs / 1000)}s!`);

        await db.query(
            `UPDATE deployments SET status = 'success', logs = $2, phase = 'completed', duration_ms = $3, finished_at = NOW() WHERE id = $1`,
            [deploymentId, allLogs.join('\n'), durationMs]
        );
        await db.query(`UPDATE services SET status = 'live', updated_at = NOW() WHERE id = $1`, [serviceId]);
        emitStatus(deploymentId, 'success');
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        const errMsg = `❌ Deployment failed: ${error.message}`;
        emitLog(deploymentId, errMsg);
        allLogs.push(errMsg);

        await db.query(
            `UPDATE deployments SET status = 'failed', logs = $2, phase = 'failed', duration_ms = $3, finished_at = NOW() WHERE id = $1`,
            [deploymentId, allLogs.join('\n'), durationMs]
        );
        await db.query(`UPDATE services SET status = 'failed', updated_at = NOW() WHERE id = $1`, [serviceId]);
        emitStatus(deploymentId, 'failed');
    } finally {
        if (ssh) ssh.dispose();
    }
}
