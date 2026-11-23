'use strict';
// Lance Electron sur n'importe quel système (Windows, Linux, macOS) : `npm start`, `npm run kiosk`.
// Retire ELECTRON_RUN_AS_NODE (défini par VS Code pour ses sous-processus) : sinon Electron démarre
// comme un simple Node et l'application plante au démarrage.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron'); // depuis Node, renvoie le chemin de l'exécutable Electron

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('close', (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
