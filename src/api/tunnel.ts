import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? __dirname, '../..');
const TUNNEL_URL_FILE = path.join(PROJECT_ROOT, '.tunnel-frontend-url');
const FRONTEND_PORT = 5173;

function getRunningTunnelProcess(): boolean {
  try {
    const ps = execSync(
      `ps aux | grep 'cloudflared.*tunnel.*${FRONTEND_PORT}' | grep -v grep`,
      { encoding: 'utf-8' }
    );
    return ps.trim().length > 0;
  } catch {
    return false;
  }
}

function startTunnel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tunnel startup timeout (30s)')), 30000);
    let resolved = false;

    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${FRONTEND_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    proc.unref();

    const handler = (data: Buffer) => {
      if (resolved) return;
      const line = data.toString();
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        resolved = true;
        clearTimeout(timeout);
        const url = match[0];
        fs.writeFileSync(TUNNEL_URL_FILE, url, 'utf-8');
        console.log(`[Tunnel] Frontend tunnel started: ${url}`);
        resolve(url);
      }
    };

    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before producing a URL`));
      }
    });
  });
}

export async function getAppUrl(): Promise<string> {
  // 1. Explicit non-localhost APP_URL always wins (set by run-tunnels.sh or user)
  const envUrl = process.env.APP_URL;
  if (envUrl && !envUrl.includes('localhost')) return envUrl;

  // 2. Check cached tunnel URL file (written by run-tunnels.sh or a previous startTunnel)
  if (fs.existsSync(TUNNEL_URL_FILE)) {
    const cached = fs.readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
    if (cached.startsWith('https://')) {
      // Verify the cloudflared process is still alive
      if (getRunningTunnelProcess()) {
        console.log(`[Tunnel] Using existing frontend tunnel: ${cached}`);
        return cached;
      }
      // Process gone — remove stale file
      console.log(`[Tunnel] Stale tunnel URL file removed (process not running)`);
      try { fs.unlinkSync(TUNNEL_URL_FILE); } catch {}
    }
  }

  // 3. No tunnel running — start one
  try {
    console.log('[Tunnel] No frontend tunnel detected, starting one...');
    const url = await startTunnel();
    return url;
  } catch (err) {
    console.error('[Tunnel] Failed to start frontend tunnel:', err);
    return envUrl || `http://localhost:${FRONTEND_PORT}`;
  }
}
