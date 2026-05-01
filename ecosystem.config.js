module.exports = {
  apps: [{
    name: 'postdealbot',
    script: './node_modules/.bin/tsx',
    args: 'server.ts',
    cwd: __dirname,
    env_file: '.env',
    watch: false,
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
  }],
};
