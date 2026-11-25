# MotoWebApp

Application web progressive (PWA) 100 % locale pour enregistrer, naviguer et analyser ses trajets moto sur smartphone Android & iOS — thème OLED noir / gris / bleu Yamaha, sans compte ni serveur.

App en ligne : https://siksss.github.io/motowebapp/

## Fonctionnalités

- **Cockpit OLED & TFT** :
  - Grand compteur vitesse (`SpeedGauge`), jauge d'inclinaison gauche/droite avec calibration `0°` (`LeanGauge`) et G-mètre longitudinal accélération/freinage (`GBar`).
  - Bascule automatique en **mode TFT paysage 2 colonnes** à l'horizontale et **mode HUD pare-brise** (`scaleY(-1)`).
  - **Chrono boucle Auto-Lap** (`⏱`) avec ligne de départ GPS virtuelle, meilleur tour et annonces vocales au passage.
  - Télémétrie capteurs en direct (`Log`) avec simulation `50 km/h`, export/partage CSV et verrouillage d'écran (`Wake Lock`).
- **Navigation, Roadbook & Copilote vocal** :
  - Carte sombre sur mesure (`OpenStreetMap`), recherche d'adresse (`Nominatim`), itinéraire OSRM **multi-étapes** (`+ Étape`) et **Trace fantôme hors-ligne** (*Suivre ce trajet*) avec détection d'écart `> 120 m`.
  - Guidage vocal Web Speech API (`500 m`, `200 m`, `50 m`) + copilote audio (paliers `10 km` et records d'inclinaison).
  - Pastille **Météo moto locale** (`Open-Meteo` : température, vent, rafales, pluie, route froide).
- **Studio Télémétrie & Coaching Pilotage** :
  - Replay synchronisé `1×` / `4×` / `10×`, triple courbe interactive **Vitesse + Angle + Altitude / pente**, coloration du tracé (`Tracé | Vitesse | Angle`) et détection automatique des virages/épingles (avec repli par courbure GPS pour GPX externes).
  - **Coaching & Fluidité** : score de fluidité (`0–100`), symétrie gauche/droite, répartition par zones d'angle (`<15°`, `15–30°`, `30–40°`, `40°+`) et conseils personnalisés.
  - **Indice Virolo** (`0–100`), badge de sortie, **carnet de bord** (tags + notes exportées en `<desc>` GPX), records personnels cliquables, histogramme d'activité 6 mois, **comparateur côte à côte**, recherche/tri, **Import/Export GPX 1.1** et **Carte souvenir PNG `1080×1350`**.
- **Hors-ligne PWA & Stockage IndexedDB** :
  - Service Worker PWA (`public/sw.js`) avec cache applicatif et cache FIFO de `250` tuiles OSM.
  - Stockage **IndexedDB** avec migration transparente depuis `localStorage` et reprise après fermeture inopinée.

## Physique de l'inclinaison (`src/stats.js`)

En virage à vitesse stabilisée, la résultante gravité + force centrifuge reste dans l'axe vertical de la moto : un accéléromètre seul ne suffit pas. `createLeanTracker` associe :
- **< 14 km/h** (`4 m/s`) : recalage sur la gravité autour du repère 3D calibré (`0°`), zone morte `< 1,5°`.
- **>= 14 km/h** : fusion gyroscopique avec la formule centrifuge $\sin(\varphi) = v \cdot \omega_{\text{up}} / g$, auto-nivellement lent en ligne droite et projection longitudinale sans fuite de gravité pour le G-mètre.
- Mapping matériel iOS WebKit (CoreMotion) et Android (W3C).

## Développement

```bash
npm install
npm test        # tests unitaires (Node test runner)
npm run build   # bundle de production (dist/)
npm run preview # aperçu local de dist/
```

Chaque push sur `main` déclenche le workflow GitHub Pages (`.github/workflows/deploy.yml`).
