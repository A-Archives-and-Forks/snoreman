const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// 各 Android 语言限定符对应的应用显示名（覆盖 app.json 的 name，默认已是 Snoreman）
// 未命中的语言回退到默认（values/ = Snoreman，拉丁字母兜底）
const LOCALIZED_APP_NAMES = {
  'values-zh': '呼噜娃',
  'values-ja': 'ぐうたん',
  'values-ko': '쿨쿨박',
};

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = function withAndroidLocalizedName(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const resDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res'
      );
      for (const [valuesDir, appName] of Object.entries(LOCALIZED_APP_NAMES)) {
        const dir = path.join(resDir, valuesDir);
        fs.mkdirSync(dir, { recursive: true });
        const xml =
          '<?xml version="1.0" encoding="utf-8"?>\n' +
          '<resources>\n' +
          `  <string name="app_name">${escapeXml(appName)}</string>\n` +
          '</resources>\n';
        fs.writeFileSync(path.join(dir, 'strings.xml'), xml);
      }
      return config;
    },
  ]);
};
