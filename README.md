# Front Vite (SPX Fake Breakout)

Dashboard React qui consomme les endpoints du backend FastAPI.

## Configuration
- Base API par défaut : `https://spx-fake-breakout.onrender.com`.
- Personnalisable via `VITE_API_BASE` (voir `.env.example`).

## Scripts
- `npm run dev` : serveur Vite en dev.
- `npm run build` : build production (`dist/`).
- `npm run preview` : prévisualisation du build.
- `npm run deploy` : déploiement Firebase Hosting (public=`dist`).

## Endpoints utilisés
- `GET /check-balance`
- `GET /api/strategy/all`, `POST /api/strategy/toggle`
- `GET /api/logs?limit=&level=&contains=`
- `GET /api/trades`
- `GET /api/opening_range/{day}`
- `GET /api/candles?day=YYYY-MM-DD`
