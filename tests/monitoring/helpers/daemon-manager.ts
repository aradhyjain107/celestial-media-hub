import { execSync, spawn, ChildProcess } from 'child_process';
import path from 'path';

export class DaemonManager {
  private directProcess: ChildProcess | null = null;
  private projectRoot: string;

  constructor() {
    // We want the directory containing monitoring/runner.js
    // celestial-media-hub/tests/monitoring/helpers/daemon-manager.ts
    // parent directories: helpers -> monitoring -> tests -> celestial-media-hub
    this.projectRoot = path.resolve(__dirname, '../../..');
  }

  // Node background runner process (direct node runner.js)
  startDirect(): ChildProcess {
    if (this.directProcess) {
      return this.directProcess;
    }
    const runnerPath = path.join(this.projectRoot, 'monitoring/runner.js');
    this.directProcess = spawn('node', [runnerPath], {
      cwd: this.projectRoot,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: 'pipe'
    });
    return this.directProcess;
  }

  stopDirect(): void {
    if (this.directProcess) {
      this.directProcess.kill('SIGTERM');
      this.directProcess = null;
    }
  }

  getDirectProcess(): ChildProcess | null {
    return this.directProcess;
  }

  // PM2 Daemon Lifecycle
  startPM2(): string {
    const configPath = path.join(this.projectRoot, 'ecosystem.config.js');
    try {
      return execSync(`npx pm2 start ${configPath}`, { cwd: this.projectRoot, encoding: 'utf8' });
    } catch (error: any) {
      throw new Error(`Failed to start PM2: ${error.message}\nStdout/Stderr: ${error.stdout || ''} ${error.stderr || ''}`);
    }
  }

  stopPM2(): string {
    try {
      return execSync('npx pm2 stop monitoring-runner', { cwd: this.projectRoot, encoding: 'utf8' });
    } catch (error: any) {
      throw new Error(`Failed to stop PM2: ${error.message}`);
    }
  }

  deletePM2(): string {
    try {
      return execSync('npx pm2 delete monitoring-runner', { cwd: this.projectRoot, encoding: 'utf8' });
    } catch (error: any) {
      throw new Error(`Failed to delete PM2: ${error.message}`);
    }
  }

  killPM2(): string {
    try {
      return execSync('npx pm2 kill', { cwd: this.projectRoot, encoding: 'utf8' });
    } catch (error: any) {
      throw new Error(`Failed to kill PM2: ${error.message}`);
    }
  }

  statusPM2(): string {
    try {
      const listOutput = execSync('npx pm2 jlist', { cwd: this.projectRoot, encoding: 'utf8' });
      const list = JSON.parse(listOutput);
      const runner = list.find((app: any) => app.name === 'monitoring-runner');
      if (runner) {
        return runner.pm2_env.status;
      }
      return 'not_found';
    } catch (error: any) {
      try {
        const statusOutput = execSync('npx pm2 status monitoring-runner', { cwd: this.projectRoot, encoding: 'utf8' });
        if (statusOutput.includes('online')) return 'online';
        if (statusOutput.includes('stopped')) return 'stopped';
        return 'unknown';
      } catch (innerError) {
        return 'error';
      }
    }
  }
}
