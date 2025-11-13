const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
      return;
    }

    const contents = fs.readFileSync(envPath, 'utf8');
    contents.split(/\r?\n/).forEach((line) => {
      if (!line || /^\s*#/.test(line)) {
        return;
      }

      const idx = line.indexOf('=');
      if (idx === -1) {
        return;
      }

      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();

      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        return;
      }

      process.env[key] = value;
    });
  } catch (err) {
    console.warn('Failed to load .env file:', err.message);
  }
})();
