// Installe la dernière version publiée (tag) dans /var/lib/frhios/app, exactement comme le bouton
// « Installer et redémarrer » des Réglages. Lancé par tools/bootstrap-update.sh, avec Electron utilisé comme Node.
const { Updater } = require('../electron/updater.js');

(async () => {
  const u = new Updater(process.env.FRHIOS_RUNNING_DIR || '/opt/frhios');
  const r = await u.apply((text) => console.log(`  · ${text}`));
  if (!r.ok) { console.error(`Échec : ${r.error}`); process.exit(1); }
  console.log(`Version ${r.tag} installée.`);
})();
