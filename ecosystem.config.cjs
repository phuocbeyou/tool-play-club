module.exports = {
  apps: [
    {
      name: "play-club-api",
      script: "index.js",
      args: "--api-only",
      out_file: "/dev/null",
      error_file: "/dev/null",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "bot-even-odd",
      script: "index.js",
      args: "--game=even_odd",
      autorestart: true,
      watch: false,
      out_file: "/dev/null",
      error_file: "/dev/null"
    }
  ]
};
