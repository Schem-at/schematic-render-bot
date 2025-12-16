module.exports = {
  apps: [{
    name: "schemat-render",
    script: "bun",
    args: "run start",
    cwd: "/Users/m1/schemat-render",
    env: {
      NODE_ENV: "production",
      PORT: process.env.PORT || 3000
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "2G",
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_file: "./logs/combined.log",
    time: true,
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: "10s"
  }]
};