"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRuntimeInstallSteps = getRuntimeInstallSteps;
exports.usesSystemd = usesSystemd;
exports.generateSystemdUnit = generateSystemdUnit;
exports.generateNginxConfig = generateNginxConfig;
function getRuntimeInstallSteps(runtime) {
    const common = [
        {
            check: 'git --version',
            install: 'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git',
            label: 'Git',
        },
        {
            check: 'nginx -v 2>&1',
            install: 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx && sudo systemctl enable nginx && sudo systemctl start nginx',
            label: 'Nginx',
        },
    ];
    const runtimeSteps = {
        node: [
            {
                check: 'node -v',
                install: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && nvm alias default 20',
                label: 'Node.js 20',
            },
            {
                check: 'pm2 -v',
                install: 'npm install -g pm2',
                label: 'PM2',
            },
        ],
        python: [
            {
                check: 'python3 --version',
                install: 'sudo apt-get update -y && sudo apt-get install -y python3 python3-pip python3-venv',
                label: 'Python 3',
            },
            {
                check: 'pip3 --version',
                install: 'sudo apt-get install -y python3-pip',
                label: 'pip',
            },
            {
                check: 'pm2 -v',
                install: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && npm install -g pm2',
                label: 'PM2 (via Node.js)',
            },
        ],
        go: [
            {
                check: 'go version',
                install: 'wget -q https://go.dev/dl/go1.21.6.linux-amd64.tar.gz && sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.21.6.linux-amd64.tar.gz && rm go1.21.6.linux-amd64.tar.gz && echo \'export PATH=$PATH:/usr/local/go/bin\' >> ~/.bashrc && export PATH=$PATH:/usr/local/go/bin',
                label: 'Go 1.21',
            },
        ],
        rust: [
            {
                check: 'rustc --version',
                install: 'curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source $HOME/.cargo/env',
                label: 'Rust (rustup)',
            },
        ],
        ruby: [
            {
                check: 'ruby --version',
                install: 'sudo apt-get update -y && sudo apt-get install -y ruby-full build-essential',
                label: 'Ruby',
            },
            {
                check: 'bundle --version',
                install: 'sudo gem install bundler',
                label: 'Bundler',
            },
            {
                check: 'pm2 -v',
                install: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && npm install -g pm2',
                label: 'PM2 (via Node.js)',
            },
        ],
        php: [
            {
                check: 'php --version',
                install: 'sudo apt-get update -y && sudo apt-get install -y php php-cli php-mbstring php-xml php-curl php-zip unzip',
                label: 'PHP',
            },
            {
                check: 'composer --version',
                install: 'curl -sS https://getcomposer.org/installer | php && sudo mv composer.phar /usr/local/bin/composer',
                label: 'Composer',
            },
            {
                check: 'pm2 -v',
                install: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && npm install -g pm2',
                label: 'PM2 (via Node.js)',
            },
        ],
        java: [
            {
                check: 'java --version',
                install: 'sudo apt-get update -y && sudo apt-get install -y openjdk-17-jdk',
                label: 'Java 17',
            },
        ],
        static: [
            {
                check: 'node -v',
                install: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && nvm alias default 20',
                label: 'Node.js (for serve)',
            },
            {
                check: 'pm2 -v',
                install: 'npm install -g pm2',
                label: 'PM2',
            },
        ],
        docker: [
            {
                check: 'docker --version',
                install: 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER',
                label: 'Docker',
            },
        ],
    };
    return [...common, ...(runtimeSteps[runtime] || runtimeSteps.node)];
}
/**
 * Check if a compiled binary runtime should use systemd instead of PM2.
 */
function usesSystemd(runtime) {
    return runtime === 'go' || runtime === 'rust' || runtime === 'java';
}
/**
 * Generate systemd service file for compiled runtimes (Go, Rust, Java).
 */
function generateSystemdUnit(name, workDir, startCommand, port, envVars) {
    const envLines = Object.entries(envVars)
        .map(([k, v]) => `Environment="${k}=${v}"`)
        .join('\n');
    return `[Unit]
Description=${name}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${workDir}
ExecStart=${workDir}/${startCommand}
Restart=always
RestartSec=5
Environment="PORT=${port}"
${envLines}

[Install]
WantedBy=multi-user.target`;
}
/**
 * Generate Nginx config for reverse proxy.
 */
function generateNginxConfig(domain, appPort) {
    return `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}`;
}
//# sourceMappingURL=runtime.js.map