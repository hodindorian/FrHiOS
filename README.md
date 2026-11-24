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
> pour ses sous-processus. Les scripts npm la retirent (`scripts/start.js`, fonctionne aussi sous Windows) ; en lancement manuel
> sous Linux : `env -u ELECTRON_RUN_AS_NODE electron .`, sous PowerShell : `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Contenu de `app/`

| Fichier | Rôle |
|---|---|
| `js/app.js` | pages, navigation, actions tactiles |
| `js/backend-mock.js` | faux appareils (mode démo) |
| `js/backend-ha.js` | client WebSocket Home Assistant (même interface que le mode démo) |
| `js/setup.js` | page « Connecter des appareils » (formulaires d'ajout de Home Assistant, appareils de la maison) |
| `../electron/ha-local.js` | Home Assistant local : compte et jeton créés tout seuls, ajout d'appareils, Matter |
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
   Le système est copié depuis l'ISO, sans internet. Il faut un disque d'au moins **24 Go**.
4. Retirez la clé, redémarrez : FrHiOS se lance tout seul en plein écran.
5. **Réglages › Wi-Fi** : choisir le réseau et saisir le mot de passe (clavier à l'écran).
6. Home Assistant démarre tout seul (quelques minutes au premier démarrage, le temps de charger son image
   embarquée dans l'ISO, sans internet). FrHiOS crée lui-même le compte et le jeton : rien à saisir.
7. **Appareils › ＋ Ajouter** (ou Réglages › Connecter des appareils) : toucher la télé, l'Ambilight, les
   Tapo… puis saisir le code affiché sur la télé ou le compte Tapo. Voir « Home Assistant » plus bas.

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
- **zsh / oh-my-zsh** : la version officielle d'oh-my-zsh est téléchargée pendant la construction de l'ISO
  (`iso/container-build.sh`) : rien à installer sur le PC qui construit. Le `.zshrc` est
  `iso/overlay/airootfs/usr/share/frhios/home/.zshrc` : une version **nettoyée** du vôtre (thème agnoster,
  plugin git, alias pacman/ls/git). Ont été volontairement retirés : identifiants et jetons, mot de passe
  en clair d'un alias, adresses de serveurs, outils de développement absents du mini PC, et l'alias
  `kill -9 -1`. Si vous ajoutez un alias à votre `.zshrc`, recopiez-le à la main dans ce fichier.

## Mettre à jour l'appareil sans réinstaller l'ISO

Réglages › **Mises à jour de FrHiOS**. L'appareil suit les **versions publiées**, c'est-à-dire les **tags** du dépôt
GitHub (`hodindorian/FrHiOS`, public : aucun jeton nécessaire). Les commits intermédiaires sont **ignorés** : pousser
du code sur `main` ne change rien sur l'appareil tant qu'aucun tag plus récent n'existe.

**Publier une version** (depuis votre PC) :

```sh
git commit -am "…" && git push
git tag v1.1.0 && git push origin v1.1.0      # c'est ce tag qui déclenche la proposition sur l'appareil
```

Seuls les tags de la forme `v1`, `v1.2`, `v1.2.3` (ou sans le `v`) comptent, classés par numéro (`v1.10.0` > `v1.9.0`).
Les autres (`latest`, `test`, `v1.0-rc1`…) sont ignorés.

Sur l'appareil :
- **Rechercher une mise à jour** : affiche le tag le plus récent et la liste des changements (titres de commits).
  Une vérification discrète a aussi lieu 90 s après le démarrage puis toutes les 6 h : une pastille apparaît sur
  « Réglages », mais **rien n'est installé sans votre accord**.
- **Installer et redémarrer** : télécharge le contenu **du tag** (jamais celui de commits plus récents), l'installe en
  quelques secondes, puis relance l'interface.
- **Retour arrière automatique** : si la nouvelle version plante au démarrage ou ne signale pas « bien démarré »
  (120 s), l'appareil revient seul à la précédente (ou à celle de l'ISO) et marque ce tag défectueux : il n'est plus
  proposé, il faut publier un tag corrigé (ex. `v1.1.1`).

**Ce que ça met à jour** : l'application (`app/`, `electron/`, `assets/`). **Ce que ça ne met pas à jour** :
- les paquets du système (Electron, Chromium, sway…) : commande `upg` dans le terminal ;
- les fichiers système de FrHiOS hors application (`sway.conf`, services, scripts de session, droits `sudo`…) :
  ceux-là demandent une **nouvelle ISO** (`./iso/build.sh`).

### Un appareil déjà installé avec une ancienne ISO (votre VM)

Le mécanisme de retour arrière vit dans le script de démarrage de l'ISO : un système installé avant lui ne peut pas
se mettre à jour seul. Une seule fois, après avoir publié un premier tag contenant ces fichiers, dans le terminal de
l'appareil (Réglages › Terminal) :

```sh
git clone --depth 1 https://github.com/hodindorian/FrHiOS.git /tmp/frhios && sh /tmp/frhios/tools/bootstrap-update.sh
```

Le script télécharge le dernier tag, remplace `/usr/local/bin/frhios-app` (mot de passe `sudo`), installe la version,
et redémarre l'interface. Ensuite tout passe par Réglages › Mises à jour. Les ISO construites après ce changement
l'intègrent d'office.

Fichiers : `electron/updater.js` (logique), `app/js/update.js` (écran), `iso/overlay/…/frhios-app` (choix de la version
et retour arrière), `tools/bootstrap-update.sh` + `tools/apply-update.cjs` (installation à usage unique). Sur l'appareil :
`/opt/frhios` (version de l'ISO), `/var/lib/frhios/app/<tag>` (versions installées), `…/current` et `…/previous` (liens),
`…/bad/` (versions défectueuses).

## Publier une version avec son ISO (GitHub)

Pousser un **tag de version** déclenche `.github/workflows/release.yml` : tests, construction de l'ISO, puis ajout
de l'ISO aux fichiers joints de la « Release » de ce tag (créée si besoin, ou complétée si vous l'avez déjà créée
depuis l'interface GitHub) :

```sh
git tag v1.1.0 && git push origin v1.1.0
```

Fichiers joints : `frhios-<tag>-x86_64.iso` et `SHA256SUMS` (vérification : `sha256sum -c SHA256SUMS`). Ce même tag est
aussi la version proposée aux appareils (Réglages › Mises à jour) : une seule étape pour publier le code **et** l'ISO.

- **Durée** : environ 20 à 40 minutes. Suivi dans l'onglet « Actions » ; relançable à la main pour un tag existant
  (« Run workflow »).
- **Pas de tag, pas d'ISO** : les commits sur `main` ne déclenchent rien ici. Un tag dont les tests échouent n'est pas publié.
- **ISO « légère »** : GitHub limite chaque fichier à 2 Go, donc l'ISO de la pipeline n'embarque **pas** les images Docker
  de Home Assistant et de Matter (~3 Go) : l'appareil les télécharge au premier démarrage (réseau nécessaire). Pour une ISO
  avec ces images (installation hors ligne) : `./iso/build.sh` sur votre PC. Si l'ISO dépassait quand même la limite, elle
  serait découpée en morceaux, avec la commande pour les recoller dans les notes de la version.
- Les tags `V1.0` (majuscule) et `v1.0.0` sont tous deux acceptés.

## Tests et pipeline GitHub

```sh
npm test        # ~40 tests, ~8 s, sans rien installer (Node, git et le shell suffisent)
```

La pipeline `.github/workflows/ci.yml` lance ces tests à chaque `push` sur `main` et à chaque demande de fusion
(onglet « Actions » du dépôt, ou « Run workflow » à la demande). Elle vérifie notamment : la syntaxe de tout le code
et des scripts de l'ISO, le système de mise à jour (tags) contre un faux dépôt, le script d'installation à usage unique, le retour arrière au démarrage, la
reconnaissance des appareils déjà connectés, l'analyse des liens YouTube/Deezer, la présence des fichiers du décor,
et l'absence de secrets dans les fichiers suivis par git. Un second contrôle, `shellcheck`, est informatif.

Elle ne construit **pas** l'ISO (trop lourd : Docker + 2 Go) ni ne teste l'affichage réel (sway, Chromium).

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

## Home Assistant (local, automatique)

Tout tourne sur l'appareil, sans compte en ligne ni autre machine :

- **Conteneurs** `frhios-ha.service` (Home Assistant) et `frhios-matter.service` (serveur Matter, pour les
  LEDs/ampoules Matter). Leurs images Docker sont **embarquées dans l'ISO** par `iso/build.sh` et chargées
  au premier démarrage (`/usr/local/bin/frhios-image`) ; sans elles (`FRHIOS_BUNDLE_IMAGES=0`), elles sont
  téléchargées. Configuration : `/var/lib/homeassistant` (créée par `frhios-ha-config`).
- **Premier démarrage** (`electron/ha-local.js`) : FrHiOS fait l'« onboarding » de HA à votre place
  (compte `frhios` / mot de passe `frhios`, France / français / Europe/Paris), crée un jeton longue
  durée et s'y connecte. Identifiants : `~/.config/frhios/home-assistant.json` (lisible seulement par
  `frhios`) ; le mot de passe est aussi visible dans **Réglages** (bouton « Afficher »).
  L'**administration web** de HA (Réglages) s'ouvre déjà connectée.
- **Ajout d'appareils** : page *Connecter des appareils*. Elle pilote les formulaires d'ajout de HA
  (les mêmes que dans son interface web, en français) : appareils détectés automatiquement par HA,
  raccourcis vers les appareils de la maison, appairage Matter, retrait d'un appareil.
- **Autre serveur** : Réglages › Source des appareils › *Autre serveur* (adresse + jeton saisis à la main).

### Appareils de la maison (scan du réseau du 23/11/2026, box Bbox)

| Appareil | Adresse | Intégration HA | Ce qu'il faut |
|---|---|---|---|
| Télé Philips 55OLED809 « Salon » (Ethernet) | 192.168.1.123 | *Android TV Remote* : marche/arrêt, volume, flèches, applis | code affiché sur la télé |
| Ambilight de la télé | 192.168.1.123 | *Philips TV* (API JointSPACE 6) : les LEDs Ambilight deviennent une lumière | autre code affiché sur la télé |
| 3 × prise Tapo P100(FR) | 192.168.1.15, .34, .154 | *TP-Link Smart Home* | e-mail + mot de passe du compte Tapo (une seule fois) ; **activer d'abord la « Compatibilité tierce »** (voir ci-dessous) |
| Enceinte Spotify Connect (probablement un Echo) | 192.168.1.147 | — | |
| Appareil Wi-Fi à puce Espressif, aucun port ouvert | 192.168.1.181 | — | probablement une LED Myko (voir ci-dessous) |

Les adresses viennent du DHCP de la box : **réservez-les** dans la Bbox (bail statique), sinon elles
peuvent changer. HA retrouve de toute façon la télé et les Tapo par découverte réseau (rubrique
« Détectés automatiquement ») ; les raccourcis ne servent qu'à pré-remplir l'adresse.

### Allumer la télé quand elle est éteinte

En veille profonde, la télé coupe son réseau : Home Assistant ne peut plus lui parler. Le bouton marche/arrêt
de la page TV envoie alors un **Wake-on-LAN** (paquet réseau qui réveille la carte réseau de la télé,
`electron/main.js`, `net:wake`) vers sa MAC (`0C:CA:FB:6E:82:92`, ou celle connue de HA), puis l'allume.

À activer **une fois sur la télé** (Philips Google TV ; le nom exact du menu varie selon la version) :
*Paramètres › Réseau et Internet* › **Allumer avec Wi-Fi (WoWLAN)** / *Wake on LAN*, et si présent
**Allumer avec Chromecast**. Sans ce réglage, la télé ne peut être allumée qu'à la télécommande.

### Prises Tapo P100 et chiffrement « TPAP »

Les P100 de la maison ont un firmware récent qui annonce le nouveau chiffrement **TPAP**. Il n'est géré par
aucune version publiée de python-kasa (la bibliothèque de Home Assistant ; 0.12.0 dans HA 2026.11.2) :
HA les voit mais répond « Unable to create device » / « Unsupported device ». Suivi :
[python-kasa #1590](https://github.com/python-kasa/python-kasa/issues/1590),
[PR #1592](https://github.com/python-kasa/python-kasa/pull/1592) (pas encore fusionnée),
[home-assistant/core #154300](https://github.com/home-assistant/core/issues/154300).

Contournement : dans l'appli **Tapo**, *Moi › Services tiers* (Third-Party Services) › activer
**Compatibilité tierce** (Third-Party Compatibility). Les prises repassent alors au chiffrement géré (KLAP)
et s'ajoutent normalement. Vérifier depuis un PC avec Docker :
`docker run --rm --entrypoint kasa ghcr.io/home-assistant/home-assistant:stable --host 192.168.1.15 state`
(« Encrypt Type: KLAP » attendu).

### LEDs Myko (« Monster », 192.168.1.181)

Confirmé le 23/11/2026 (l'adresse disparaît quand on les débranche ; nom Bbox « espressif »).
Modèle **Klite Strip Light**, série `D0EF76CBB924` (= son adresse MAC), firmware v1.4.11. Elles sont
**pilotées uniquement par le cloud Myko** : aucun port ouvert, aucune annonce mDNS / Matter / SSDP.

- L'ancienne appli Myko reposait sur la plateforme **Afero**. La bibliothèque `aioafero` (utilisée par
  l'intégration *Hubspace*) a géré Myko jusqu'à sa version 7.0.3 (juin 2026), puis l'a retiré ; ses serveurs
  (`api2.sxz2xlhh.afero.net`) n'existent plus.
- Castorama a remplacé l'appli par **Myko+** au 31/01/2026 ; aucune information publique sur sa plateforme,
  aucune intégration Home Assistant.

Solution conseillée : **garder le ruban et remplacer son boîtier de commande** par un contrôleur WLED (Wi-Fi,
100 % local, souvent vendu avec WLED préinstallé) de même tension (5 / 12 / 24 V) et même nombre de broches
(RGB 4 broches, RGBW 5, CCT 3…) ; il s'ajoute dans *Connecter des appareils › Ruban LED WLED* ou apparaît
dans « Détectés automatiquement ». Autres pistes : un code **Matter** depuis Myko+ s'il existe (*Connecter des appareils › Appareil Matter*) ;
remplacer par des LEDs Matter ou Tapo ; ou reprogrammer le contrôleur (puce Espressif) avec WLED / ESPHome
(ouverture du boîtier, liaison série, risque de le rendre inutilisable).

### Une tuile par appareil

HA crée plusieurs entités par appareil (prise Tapo : interrupteur + LED + arrêt automatique + mises à jour…).
La page Appareils n'affiche que l'entité principale (les entités « réglage » / « diagnostic » de HA sont
masquées) et « Tout éteindre » ne touche qu'elles. *Réglages › Tout afficher* montre tout.

## Limites connues

- **Connexion Google** : Google refuse parfois la connexion depuis un navigateur embarqué. Le
  user-agent est celui de Chrome (sans « Electron ») pour limiter le risque, sans garantie.
  Sur Deezer, préférer e-mail + mot de passe à « Continuer avec Google/Facebook ».
- **Clavier à l'écran** : AZERTY avec accents, chiffres et symboles (`?123`), majuscule et
  effacement répété. Réglages › « Clavier à l'écran » : *Auto* (après un contact tactile, ou toujours
  avec `--kiosk`), *Toujours* ou *Jamais*. Le bouton ⌨ de la page Musique l'ouvre à la main.
  Dans YouTube/Deezer il écrit dans le champ actif ; il n'y a pas de touches fléchées ni Tab.
- **Pas de DRM Widevine** dans Electron : suffisant pour YouTube et Deezer, pas pour du contenu protégé.
- **Jeton Home Assistant** : en mode *Autre serveur*, stocké en clair dans le localStorage ; en mode local,
  dans `~/.config/frhios/home-assistant.json` (droits 0600).
- L'automatisation de HA (`ha-local.js`) et la page d'ajout ont été testées contre un **faux serveur** qui imite
  les API de HA (onboarding, jetons, formulaires d'ajout, Matter), pas encore contre un vrai Home Assistant.

## Actions personnalisées (accueil)

Les boutons sous l'horloge (« Tout éteindre », « Ambiance chaude ») sont intégrés. Toutes les **scènes** et tous les **scripts** de Home Assistant s'y ajoutent automatiquement, à côté : créez-les dans HA (Réglages › Ouvrir, ou le bouton « ＋ Action »), puis *Paramètres › Automatisations et scènes › Scènes* (ou *Scripts*). Une scène/un script marqué « masqué » dans HA n'apparaît pas.

## Étapes

1. ✅ Prototype de l'interface (mode démo)
2. ✅ Home Assistant local automatique + ajout de la télé, de l'Ambilight et des Tapo depuis l'écran ;
   ⏳ à valider sur l'appareil ; LEDs Myko : cloud uniquement (voir « LEDs Myko »)
3. ⏳ Finitions musique
4. ⏳ Image Linux kiosque (Cage + Chromium) pour le petit PC
