import { EventEmitter } from 'events';
export declare const deploymentEvents: EventEmitter<[never]>;
export declare function runDeployment(deploymentId: string, serviceId: string, commitSha?: string, commitMessage?: string): Promise<void>;
//# sourceMappingURL=deploy.d.ts.map