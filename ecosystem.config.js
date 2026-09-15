module.exports = {
  apps: [{
    name: 'postdealbot',
    script: 'node',
    args: '--env-file=.env ./node_modules/.bin/tsx server.ts',
    cwd: __dirname,
    watch: false,
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      // NODE_OPTIONS è ereditato da tutti i processi figli (incluso tsx → server.ts)
      NODE_OPTIONS: '--max-old-space-size=512',
    },
  }],
};
