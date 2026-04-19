-- DEXODEP v2.0 Schema

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id BIGINT UNIQUE NOT NULL,
  github_username VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL DEFAULT 'ubuntu',
  ssh_private_key TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'connecting' CHECK (status IN ('connecting', 'active', 'error')),
  os_info JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(30) DEFAULT 'web_service' CHECK (type IN ('web_service', 'static_site', 'background_worker', 'cron_job')),
  github_repo VARCHAR(255) NOT NULL,
  branch VARCHAR(255) DEFAULT 'main',
  runtime VARCHAR(30) DEFAULT 'node' CHECK (runtime IN ('node', 'python', 'go', 'ruby', 'rust', 'php', 'java', 'static', 'docker')),
  runtime_version VARCHAR(50) DEFAULT '',
  root_dir VARCHAR(500) DEFAULT '/var/www/app',
  build_command TEXT DEFAULT '',
  start_command TEXT NOT NULL,
  app_port INTEGER DEFAULT 3000,
  domain VARCHAR(255) DEFAULT '',
  env_vars JSONB DEFAULT '{}',
  webhook_secret VARCHAR(255) NOT NULL,
  auto_deploy BOOLEAN DEFAULT true,
  health_check_path VARCHAR(255) DEFAULT '/',
  status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created', 'deploying', 'live', 'failed', 'stopped', 'suspended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  phase VARCHAR(50) DEFAULT '',
  logs TEXT DEFAULT '',
  triggered_by VARCHAR(50) DEFAULT 'manual',
  commit_sha VARCHAR(255),
  commit_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL,
  ssl_status VARCHAR(20) DEFAULT 'pending' CHECK (ssl_status IN ('pending', 'active', 'failed')),
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servers_user_id ON servers(user_id);
CREATE INDEX IF NOT EXISTS idx_services_user_id ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_services_server_id ON services(server_id);
CREATE INDEX IF NOT EXISTS idx_deployments_service_id ON deployments(service_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domains_service_id ON domains(service_id);
