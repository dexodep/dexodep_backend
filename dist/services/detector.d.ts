export interface DetectionResult {
    runtime: string;
    runtimeVersion: string;
    buildCommand: string;
    startCommand: string;
    appPort: number;
}
/**
 * Detect language/runtime from a GitHub repo by checking for known files.
 * Uses GitHub API (no clone needed).
 */
export declare function detectFromGitHub(accessToken: string, repoFullName: string, branch: string): Promise<DetectionResult>;
//# sourceMappingURL=detector.d.ts.map