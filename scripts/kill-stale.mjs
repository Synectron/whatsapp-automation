/**
 * Pre-dev cleanup: kills leftover puppeteer Chrome processes and whatever is
 * still listening on the app port. nodemon on Windows often fails to kill the
 * previous ts-node child on restart, which orphans the server (EADDRINUSE)
 * and its Chrome, wedging the WhatsApp session.
 */
import { execSync } from 'node:child_process';

const PORT = process.env.PORT || '4000';

const run = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
};

if (process.platform === 'win32') {
  // Chrome instances launched from the puppeteer cache.
  const wmic = run(
    'powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \'*puppeteer*\' } | ForEach-Object { $_.Id }"',
  );
  const chromePids = wmic.split(/\r?\n/).filter((line) => /^\d+$/.test(line.trim()));
  for (const pid of chromePids) run(`taskkill /F /PID ${pid.trim()}`);

  // Anything still listening on the app port (an orphaned previous server).
  const netstat = run(`netstat -ano -p tcp`);
  const pids = new Set(
    netstat
      .split(/\r?\n/)
      .filter((line) => line.includes(`:${PORT}`) && line.includes('LISTENING'))
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((pid) => pid && pid !== '0' && pid !== String(process.pid)),
  );
  for (const pid of pids) run(`taskkill /F /PID ${pid}`);
  if (chromePids.length || pids.size) {
    console.log(`[kill-stale] cleaned ${chromePids.length} chrome, ${pids.size} port-${PORT} process(es)`);
  }
} else {
  run(`pkill -f '\\.cache/puppeteer' || true`);
  run(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
}
