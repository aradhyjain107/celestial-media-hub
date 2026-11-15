module.exports = {
  apps: [
    // ─────────────────────────────────────────────────────────────────
    // Celestial Dev Server — supervised Next.js process
    // Run:  npm run dev:supervised
    // Stop: npm run dev:stop
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'celestial-dev',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 3000',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_memory_restart: '1500M',
      // Exponential back-off: wait 2s → 4s → 8s … up to 30s between restarts
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      max_restarts: 15,
      min_uptime: '5s',
      // Pipe stdout/stderr to structured log files
      out_file: 'logs/celestial-dev-out.log',
      error_file: 'logs/celestial-dev-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Environment
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Monitoring runner (pre-existing)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'monitoring-runner',
      script: './monitoring/runner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
      },
      env_production: {
        NODE_ENV: 'production',
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
      },
    },
  ],
};
