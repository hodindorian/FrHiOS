# FrHiOS

Interface tactile pour piloter la maison depuis un petit PC sans clavier ni souris :
lumières et prises (Tapo, LEDs Myko…), télé Philips 55OLED809, musique (YouTube, Deezer).

## Architecture

```
PC (i5, DDR4) + écran tactile avec haut-parleurs
└─ Linux minimal (sans bureau)                  ← étape 4 : image « kiosque »
   └─ Cage (compositeur Wayland plein écran) + Chromium
      └─ app/   l'interface tactile (cette étape)
         └─ Home Assistant (conteneur)           ← étape 2 : Tapo, Myko, TV Philips
```

L'interface ne parle jamais directement aux appareils : elle parle à Home Assistant,
qui sait déjà dialoguer avec Tapo, Tuya, Android TV, etc.

## Lancer l'application

```sh
npm install        # une seule fois (télécharge Electron)
npm start          # fenêtre normale
npm run kiosk      # plein écran, curseur masqué (PC tactile)
```

Dans **Electron**, la page Musique affiche les vrais sites YouTube et Deezer (navigateurs embarqués,
une session persistante par site : on se connecte une fois). Ils restent chargés en arrière-plan,
donc la musique continue quand on change de page.

Sans Electron, l'interface fonctionne aussi dans un navigateur (les sites ne peuvent pas y être
intégrés, la page Musique revient alors au mode « coller un lien ») :

```sh
npm run web        # puis ouvrir http://127.0.0.1:8765/app/
```

Le mode démo utilise de faux appareils : rien n'est envoyé sur le réseau.

- `#home`, `#devices`, `#tv`, `#music`, `#settings` après l'adresse ouvrent directement une page.
- `?kiosk` masque le curseur de souris (ajouté automatiquement par `npm run kiosk`).

> Si Electron démarre comme un simple Node (erreur « Cannot read properties of undefined (reading
> 'commandLine') »), c'est que la variable `ELECTRON_RUN_AS_NODE` est définie, ce que fait VS Code
> pour ses sous-processus. Les scripts npm la retirent ; en lancement manuel : `env -u ELECTRON_RUN_AS_NODE`.

## Contenu de `app/`

| Fichier | Rôle |
|---|---|
| `js/app.js` | pages, navigation, actions tactiles |
| `js/backend-mock.js` | faux appareils (mode démo) |
| `js/backend-ha.js` | client WebSocket Home Assistant (même interface que le mode démo) |
| `js/osk.js` | clavier AZERTY à l'écran (champs de l'interface **et** recherche dans YouTube/Deezer) |
| `../electron/view-preload.js` | détecte les champs de texte dans YouTube/Deezer (n'expose rien aux sites) |
| `../assets/background.jpg` | fond d'écran, teinté en violet par le CSS (`hue-rotate`) |
| `js/music-electron.js` | page Musique dans Electron : onglets + zone où se superposent les sites |
| `js/music.js` | page Musique dans un navigateur : lecteurs intégrés officiels via des liens |
| `../electron/main.js` | fenêtre, serveur local, vues YouTube / Deezer (sessions persistantes) |
| `../electron/preload.js` | pont minimal interface ↔ processus principal |
| `js/store.js`, `js/icons.js` | réglages (localStorage), icônes SVG |
| `css/style.css` | thème sombre, cibles tactiles larges |

## Installer sur le mini PC (ISO + Ventoy)

```sh
./iso/build.sh          # construit iso/out/frhios-AAAA.MM.JJ-x86_64.iso (Docker, ~15 min la 1re fois)
./iso/test-vm.sh install  # (facultatif) l'essaie dans une machine virtuelle QEMU/UEFI
```

1. Copiez le fichier `.iso` sur la clé Ventoy (simple copie de fichier, dans la partition de données).
2. Sur le mini PC : démarrez sur la clé (touche de menu de démarrage), choisissez l'ISO dans Ventoy
   (mode normal ; si l'ISO ne démarre pas, rebootez et choisissez le **mode GRUB2** dans le menu Ventoy).
   Secure Boot doit être désactivé (ou la clé Ventoy enregistrée).
3. L'assistant d'installation tactile s'affiche : choisir le disque, confirmer l'effacement.
   Le système est copié depuis l'ISO, sans internet. Il faut un disque d'au moins **14 Go**.
4. Retirez la clé, redémarrez : FrHiOS se lance tout seul en plein écran.
5. **Réglages › Wi-Fi** : choisir le réseau et saisir le mot de passe (clavier à l'écran).
6. Home Assistant se télécharge tout seul au premier démarrage (réseau nécessaire, ~1 Go, quelques minutes),
   puis est joignable via **Réglages › Administration de Home Assistant** : créer le compte, ajouter les
   intégrations, puis créer le jeton (Profil › Sécurité), le **copier**, et le coller (touche « Coller »
   du clavier, couche `?123`) dans Réglages › Home Assistant.

Détails du système installé : utilisateur `frhios` (connexion automatique sur la console 1), mot de passe
initial `frhios` pour la maintenance au clavier (console 2 : Ctrl+Alt+F2 ; à changer avec `passwd`),
`root` verrouillé, pas de SSH. Réglages d'affichage de la machine : `/etc/frhios.conf`
(par ex. `ELECTRON_EXTRA_FLAGS="--disable-gpu"`).

## Éteindre, terminal, zsh

- **Éteindre** : bouton au-dessus de « Réglages » (éteindre / redémarrer). Refusé hors mode kiosque
  (`npm run kiosk` ou l'ISO), pour ne pas éteindre votre PC de travail pendant le développement.
- **Terminal** : Réglages › Terminal. Vrai shell zsh (couleurs, vim, sudo…) qui reste ouvert quand on
  change de page. Le clavier à l'écran gagne une rangée Échap / Tab / Ctrl / flèches / `^C` et une
  couche de symboles (`#+=` : `| ~ \ { } [ ] $ * < >` …). Mettre à jour le système : `upg`
  (alias de `sudo pacman -Syyu --noconfirm`), mot de passe sudo : celui de `frhios`.
- **zsh / oh-my-zsh** : `iso/build.sh` copie votre `~/.oh-my-zsh` (sans `.git`) dans l'ISO. Le `.zshrc` est
  `iso/overlay/airootfs/usr/share/frhios/home/.zshrc` : une version **nettoyée** du vôtre (thème agnoster,
  plugin git, alias pacman/ls/git). Ont été volontairement retirés : identifiants et jetons, mot de passe
  en clair d'un alias, adresses de serveurs, outils de développement absents du mini PC, et l'alias
  `kill -9 -1`. Si vous ajoutez un alias à votre `.zshrc`, recopiez-le à la main dans ce fichier.

## YouTube et la connexion Google

Google refuse la connexion à un compte depuis un navigateur intégré comme Electron (« Ce navigateur ou
cette application ne sont peut-être pas sécurisés ») : c'est une protection volontaire, FrHiOS ne la
contourne pas. Sur l'appareil, **YouTube tourne donc dans un vrai Chromium**, affiché par-dessus la zone
« Musique » de l'interface :

- l'appareil utilise le compositeur **sway** (à la place de Cage) : il place la fenêtre Chromium
  exactement sur la zone Musique (`electron/youtube-window.js`) ; la lecture continue en arrière-plan ;
- le clavier à l'écran envoie les touches à Chromium avec `wtype` : touchez le bouton ⌨ de la page
  Musique, puis le champ à remplir (pas de détection automatique des champs dans Chromium) ;
- profil Chromium séparé : `~/.config/frhios-youtube` (vos connexions y restent) ;
- Deezer reste dans une vue Electron (pas de blocage de ce côté).

En développement (`npm start` sur votre PC, hors sway), YouTube reste la vue intégrée : sans connexion Google
possible (recherche et lecture seulement).

## Dépannage de l'affichage

Les journaux de la session sont dans `/tmp/frhios-sway.log` et `/tmp/frhios-app.log`. Depuis une console
texte (Ctrl+Alt+F2 ou F3 ; Ctrl droite + F2 dans VirtualBox), connexion `frhios` / `frhios`, puis :
`cat /tmp/frhios-sway.log /tmp/frhios-app.log`. Dans une machine virtuelle, le rendu logiciel est automatique.

Tests dans QEMU : `./iso/test-vm.sh install`. KVM refuse de démarrer si VirtualBox tourne en même temps
(erreur `KVM: entry failed`) : fermer la VM VirtualBox, ou `FRHIOS_VM_ACCEL=tcg` (très lent).

## Connexion à Home Assistant (étape 2)

1. Dans Home Assistant : Profil › Sécurité › **Jeton d'accès longue durée**.
2. Dans l'app : Réglages › Home Assistant, adresse (`http://IP:8123`) et jeton.

Intégrations à ajouter dans Home Assistant :

- **Tapo** : intégration *TP-Link Smart Home* (compte Tapo requis pour les firmwares récents).
- **TV Philips 55OLED809** (Google TV) : intégration *Android TV Remote*. Elle crée une
  entité `media_player` (volume, marche/arrêt) et une entité `remote` (flèches, OK, applis).
  L'app utilise les deux automatiquement.
- **LEDs Myko** : protocole à identifier (Tuya/Smart Life, Afero, Matter…). À scanner depuis
  le réseau de la maison.

## Limites connues

- **Connexion Google** : Google refuse parfois la connexion depuis un navigateur embarqué. Le
  user-agent est celui de Chrome (sans « Electron ») pour limiter le risque, sans garantie.
  Sur Deezer, préférer e-mail + mot de passe à « Continuer avec Google/Facebook ».
- **Clavier à l'écran** : AZERTY avec accents, chiffres et symboles (`?123`), majuscule et
  effacement répété. Réglages › « Clavier à l'écran » : *Auto* (après un contact tactile, ou toujours
  avec `--kiosk`), *Toujours* ou *Jamais*. Le bouton ⌨ de la page Musique l'ouvre à la main.
  Dans YouTube/Deezer il écrit dans le champ actif ; il n'y a pas de touches fléchées ni Tab.
- **Pas de DRM Widevine** dans Electron : suffisant pour YouTube et Deezer, pas pour du contenu protégé.
- **Jeton Home Assistant** : stocké en clair dans le localStorage du navigateur du PC.
- Le client Home Assistant (`backend-ha.js`) n'a pas encore été testé contre un vrai serveur.

## Étapes

1. ✅ Prototype de l'interface (mode démo)
2. ⏳ Home Assistant + Tapo + TV Philips + scan des LEDs Myko (à faire sur le réseau de la maison)
3. ⏳ Finitions musique
4. ⏳ Image Linux kiosque (Cage + Chromium) pour le petit PC
