const dbAsync = require('../config/database-promise');

class ConfigService {
  async getConfig(key) {
    const row = await dbAsync.get('SELECT value FROM config WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async getAllConfigs() {
    const rows = await dbAsync.all('SELECT key, value FROM config');
    const result = {};
    if (rows) {
      rows.forEach(r => result[r.key] = r.value);
    }
    return result;
  }

  async setConfig(key, value) {
    await dbAsync.run(
      `INSERT INTO config (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, String(value)]
    );
    return true;
  }
}

module.exports = new ConfigService();
