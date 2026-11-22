# MotoWebApp 🏍️

Application web (PWA) pour enregistrer ses trajets moto — un mélange de Strava et Waze.

- **Carte en direct** (OpenStreetMap) avec position et tracé en cours
- **Navigation** : recherche d'adresse (Nominatim) + itinéraire (OSRM)
- **Enregistrement** des trajets via le GPS du téléphone
- **Statistiques** : distance, durée, temps en mouvement, vitesse max / moyenne, **inclinaison max gauche / droite**
- Données stockées **localement** sur le téléphone (pas de compte, pas de serveur)

## Utilisation

Ouvre https://&lt;ton-user&gt;.github.io/motowebapp/ sur ton téléphone, puis « Ajouter à l'écran d'accueil ».
Fixe le téléphone sur la moto (n'importe quelle orientation, mais **fixe**), appuie sur « Rouler ».
L'écran reste allumé pendant l'enregistrement (le GPS du navigateur s'arrête si l'écran se verrouille).

### Comment l'inclinaison est calculée

En virage, l'accéléromètre ressent toujours la « gravité » dans l'axe de la moto : on ne peut pas lire l'angle directement.
On utilise le gyroscope : `sin(angle) = vitesse × vitesse_de_rotation / g` (voir `src/stats.js`).

## Développement

```bash
npm install
npm run dev     # serveur local
npm test        # tests des calculs
npm run build
```

Chaque push sur `main` déploie automatiquement sur GitHub Pages.

## À venir

- Signalements communautaires (radars, dangers) avec Supabase
- Guidage vocal tour par tour
- Export GPX
