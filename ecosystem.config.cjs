module.exports = {
  apps: [
    {
      name: "play-club-api",
      script: "index.js",
      args: "--api-only",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "bot-even-odd",
      script: "index.js",
      args: "--game=even_odd",
      autorestart: true,
      watch: false
    }
  ]
};
