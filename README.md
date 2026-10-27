# Aman Roadlines Transport Management

React and Express transport management system backed by MongoDB Atlas.

## Project layout

- client/: React + Vite dashboard
- server/: Express API, authentication, and Mongoose models
- .env: local server credentials; ignored by Git
- Root npm workspaces: shared install and run scripts

## Run locally

Requires Node.js 20 or later.

1. Install dependencies from the repository root: npm install.
2. Copy .env.example to .env and set the MongoDB URI, JWT secret, and admin email/password.
3. Start the API and frontend together: npm run dev:all.
4. Open the Vite URL shown in the terminal, usually http://localhost:5173.

The Vite development server proxies /api requests to Express on port 4000. You can also run npm run dev for only the frontend or npm run dev:server for only the API.

## Production build

- Build the frontend: npm run build.
- Start the production server: npm start.

In production, Express serves the built React app and API from the same origin. The host must provide a persistent Node web service, HTTPS, and a public PORT. The API health endpoint is /api/health.

## MongoDB and credentials

Keep MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD in the hosting provider's server-side environment variables. Never add them to client variables or commit .env.

For local development, optional ATLAS_PROJECT_ID, ATLAS_SERVICE_ACCOUNT_CLIENT_ID, and ATLAS_SERVICE_ACCOUNT_CLIENT_SECRET settings can add the developer machine's current public IP to Atlas before the API connects. Do not configure these Atlas administration credentials on the public production service. Instead, allowlist the production host's stable outbound IP address or addresses in Atlas Network Access, and leave the service-account credentials unset in production.

The configured admin email and password create the initial account only if that email does not already exist in the database. When deploying against the existing database, continue using its current admin login.

## Before client go-live

- Use a private source repository and confirm .env, database exports, vehicle documents, and screenshots are not committed.
- Restrict Atlas database access to the application host's egress IP addresses; never use 0.0.0.0/0.
- Enable an Atlas backup plan appropriate for the business data and verify that a restore can be performed.
- Set NODE_ENV=production and CLIENT_ORIGIN to the deployed HTTPS origin.
- Store production secrets in the hosting provider's secret/environment settings, not in GitHub.

## Vercel deployment

Vercel runs the root Express export as a serverless function and serves the Vite build from the root public directory. The API reuses Mongoose connections across warm function instances and connects on demand. Set MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, and NODE_ENV=production in Vercel Project Settings; do not configure Atlas administration service-account credentials there. Vercel Hobby is limited to noncommercial personal use; use a paid plan for client/business production.
