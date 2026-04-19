/**
 * Runtime-specific install commands for each language.
 * All commands designed for Ubuntu/Debian servers.
 */
interface InstallStep {
    check: string;
    install: string;
    label: string;
}
export declare function getRuntimeInstallSteps(runtime: string): InstallStep[];
/**
 * Check if a compiled binary runtime should use systemd instead of PM2.
 */
export declare function usesSystemd(runtime: string): boolean;
/**
 * Generate systemd service file for compiled runtimes (Go, Rust, Java).
 */
export declare function generateSystemdUnit(name: string, workDir: string, startCommand: string, port: number, envVars: Record<string, string>): string;
/**
 * Generate Nginx config for reverse proxy.
 */
export declare function generateNginxConfig(domain: string, appPort: number): string;
export {};
//# sourceMappingURL=runtime.d.ts.map