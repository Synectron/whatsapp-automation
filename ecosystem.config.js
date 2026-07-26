/**
 * PM2 ecosystem file.
 *   pm2 start ecosystem.config.js --env production
 *
 * The WhatsApp client owns a Chromium instance and an exclusive auth folder,
 * so the app must run as a SINGLE instance (no cluster mode).
 */
module.exports = {
  apps: [
    {
      name: 'whatsapp-group-assistant',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      kill_timeout: 15000,
      listen_timeout: 20000,
      wait_ready: false,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
