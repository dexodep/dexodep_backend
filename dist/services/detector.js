"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFromGitHub = detectFromGitHub;
/**
 * Detect language/runtime from a GitHub repo by checking for known files.
 * Uses GitHub API (no clone needed).
 */
async function detectFromGitHub(accessToken, repoFullName, branch) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
    };
    const baseUrl = `https://api.github.com/repos/${repoFullName}/contents`;
    // Fetch root directory listing
    let rootFiles = [];
    try {
        const res = await fetch(`${baseUrl}?ref=${branch}`, { headers });
        if (res.ok) {
            const data = (await res.json());
            rootFiles = data.map((f) => f.name);
        }
    }
    catch {
        // fallback to defaults
    }
    // Helper to fetch file content
    async function getFileContent(path) {
        try {
            const res = await fetch(`${baseUrl}/${path}?ref=${branch}`, { headers });
            if (!res.ok)
                return null;
            const data = (await res.json());
            if (data.content && data.encoding === 'base64') {
                return Buffer.from(data.content, 'base64').toString('utf-8');
            }
            return null;
        }
        catch {
            return null;
        }
    }
    // Check for Dockerfile first
    if (rootFiles.includes('Dockerfile')) {
        return {
            runtime: 'docker',
            runtimeVersion: '',
            buildCommand: 'docker build -t app .',
            startCommand: 'docker run -d -p $PORT:$PORT app',
            appPort: 3000,
        };
    }
    // Node.js detection
    if (rootFiles.includes('package.json')) {
        const content = await getFileContent('package.json');
        let pkg = {};
        if (content) {
            try {
                pkg = JSON.parse(content);
            }
            catch {
                /* empty */
            }
        }
        const scripts = pkg.scripts || {};
        let buildCmd = '';
        let startCmd = 'node index.js';
        let port = 3000;
        // Detect build command
        if (scripts.build) {
            buildCmd = 'npm run build';
        }
        // Detect start command
        if (scripts.start) {
            startCmd = 'npm start';
        }
        else if (scripts.dev) {
            startCmd = 'npm run dev';
        }
        // Check for Next.js
        if (content && content.includes('"next"')) {
            buildCmd = 'npm run build';
            startCmd = 'npm start';
            port = 3000;
        }
        // Check for Vite / static
        if (content && (content.includes('"vite"') || content.includes('"@vitejs'))) {
            buildCmd = 'npm run build';
            startCmd = 'npx serve -s dist -l $PORT';
            port = 3000;
        }
        // Check for NestJS
        if (content && content.includes('"@nestjs/core"')) {
            buildCmd = 'npm run build';
            startCmd = 'node dist/main';
        }
        const nodeVersion = pkg.engines?.node || '20';
        return {
            runtime: 'node',
            runtimeVersion: nodeVersion,
            buildCommand: buildCmd,
            startCommand: startCmd,
            appPort: port,
        };
    }
    // Python detection
    if (rootFiles.includes('requirements.txt') || rootFiles.includes('Pipfile') || rootFiles.includes('pyproject.toml')) {
        let buildCmd = 'pip install -r requirements.txt';
        let startCmd = 'python main.py';
        if (rootFiles.includes('Pipfile')) {
            buildCmd = 'pip install pipenv && pipenv install --deploy';
            startCmd = 'pipenv run python main.py';
        }
        if (rootFiles.includes('pyproject.toml')) {
            buildCmd = 'pip install .';
        }
        // Check for common frameworks
        if (rootFiles.includes('manage.py')) {
            // Django
            startCmd = 'gunicorn config.wsgi:application --bind 0.0.0.0:$PORT';
        }
        else if (rootFiles.includes('app.py') || rootFiles.includes('wsgi.py')) {
            // Flask/Gunicorn
            startCmd = 'gunicorn app:app --bind 0.0.0.0:$PORT';
        }
        else if (rootFiles.includes('main.py')) {
            // FastAPI / Uvicorn
            const mainContent = await getFileContent('main.py');
            if (mainContent && (mainContent.includes('FastAPI') || mainContent.includes('fastapi'))) {
                startCmd = 'uvicorn main:app --host 0.0.0.0 --port $PORT';
            }
        }
        return {
            runtime: 'python',
            runtimeVersion: '3.11',
            buildCommand: buildCmd,
            startCommand: startCmd,
            appPort: 8000,
        };
    }
    // Go detection
    if (rootFiles.includes('go.mod')) {
        const modContent = await getFileContent('go.mod');
        let goVersion = '1.21';
        if (modContent) {
            const match = modContent.match(/^go\s+([\d.]+)/m);
            if (match)
                goVersion = match[1];
        }
        return {
            runtime: 'go',
            runtimeVersion: goVersion,
            buildCommand: 'go build -o app .',
            startCommand: './app',
            appPort: 8080,
        };
    }
    // Rust detection
    if (rootFiles.includes('Cargo.toml')) {
        const cargoContent = await getFileContent('Cargo.toml');
        let binaryName = 'app';
        if (cargoContent) {
            const match = cargoContent.match(/name\s*=\s*"([^"]+)"/);
            if (match)
                binaryName = match[1];
        }
        return {
            runtime: 'rust',
            runtimeVersion: 'stable',
            buildCommand: 'cargo build --release',
            startCommand: `./target/release/${binaryName}`,
            appPort: 8080,
        };
    }
    // Ruby detection
    if (rootFiles.includes('Gemfile')) {
        let startCmd = 'bundle exec ruby app.rb';
        if (rootFiles.includes('config.ru') || rootFiles.includes('Rakefile')) {
            // Rails
            startCmd = 'bundle exec rails server -b 0.0.0.0 -p $PORT';
        }
        return {
            runtime: 'ruby',
            runtimeVersion: '3.2',
            buildCommand: 'bundle install',
            startCommand: startCmd,
            appPort: 3000,
        };
    }
    // PHP detection
    if (rootFiles.includes('composer.json')) {
        let startCmd = 'php -S 0.0.0.0:$PORT -t public';
        if (rootFiles.includes('artisan')) {
            // Laravel
            startCmd = 'php artisan serve --host=0.0.0.0 --port=$PORT';
        }
        return {
            runtime: 'php',
            runtimeVersion: '8.2',
            buildCommand: 'composer install --no-dev --optimize-autoloader',
            startCommand: startCmd,
            appPort: 8000,
        };
    }
    // Java detection
    if (rootFiles.includes('pom.xml') || rootFiles.includes('build.gradle') || rootFiles.includes('build.gradle.kts')) {
        const isMaven = rootFiles.includes('pom.xml');
        return {
            runtime: 'java',
            runtimeVersion: '17',
            buildCommand: isMaven ? './mvnw package -DskipTests' : './gradlew build -x test',
            startCommand: 'java -jar target/*.jar',
            appPort: 8080,
        };
    }
    // Static site (only HTML files)
    if (rootFiles.includes('index.html')) {
        return {
            runtime: 'static',
            runtimeVersion: '',
            buildCommand: '',
            startCommand: 'npx serve -s . -l $PORT',
            appPort: 3000,
        };
    }
    // Default fallback
    return {
        runtime: 'node',
        runtimeVersion: '20',
        buildCommand: 'npm install',
        startCommand: 'npm start',
        appPort: 3000,
    };
}
//# sourceMappingURL=detector.js.map