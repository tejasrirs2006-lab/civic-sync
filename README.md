# CIVIC SYNC

CIVIC SYNC is a civic complaint and dashboard prototype built with React, TypeScript, Vite, and Tailwind CSS. It supports role-based access for:

- Citizen
- Municipal Officer
- Municipality Head

## Local development

```bash
npm install
npm run dev
```

The app runs in local development mode with the frontend and mock backend together.

## Vercel deployment

This project is ready to deploy on Vercel as a frontend app.

### Required config

A Vercel config file has been added:

- [vercel.json](vercel.json)

This ensures React Router routes work correctly on refresh and direct navigation.

### Deploy steps

1. Push the project to GitHub.
2. Open https://vercel.com
3. Import the repository.
4. Keep the default Vite settings:
   - Framework: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Click Deploy.

### Important note

The Express server in the `server/` folder is intended for local development/testing only. Vercel will host the frontend static build, while the local mock API is not automatically deployed with the frontend.

If you want a production-ready deployment with live APIs, move the backend logic to Vercel Serverless Functions or a separate backend service.

## Build check

```bash
npm run build
```

This project successfully builds for production with Vite.
