module.exports = {
  apps: [{
    name: 'motovibe-api',
    script: 'server.js',
    cwd: '/var/www/motovibe',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5001
    }
  }]
};
