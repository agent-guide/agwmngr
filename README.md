# Manager

A Bun + Next.js full-stack management application for AGW. The backend API and frontend are served from the same Next.js process on the same port. There is no separate API server.

## Configuration

Create a `.env.local` file in this directory:

```bash
# Admin credentials
CADDYMGR_ADMIN_USER=admin
CADDYMGR_ADMIN_PASSWORD_HASH=<bcrypt hash of your password>

# Caddy admin API address (default: http://localhost:2019)
CADDY_ADMIN_ADDR=http://localhost:2019

# Gateway admin API address (default: http://localhost:8080)
GATEWAY_ADDR=http://localhost:8080
GATEWAY_ADMIN_USER=<gateway admin user>
GATEWAY_ADMIN_PASSWORD=<gateway admin password>

# Comma-separated read-only Caddy server IDs (optional)
CADDYMGR_READONLY_SERVER_IDS=

# Frontend API base URL — leave empty since frontend and backend are co-hosted
NEXT_PUBLIC_API_BASE_URL=
```

Generate a bcrypt password hash:

```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('yourpassword', 10).then(console.log)"
```

## Build and Run

```bash
# Install dependencies
bun install

# Start development server (port 3000)
bun run dev

# Production build
bun run build

# Start production server
bun run start

# Lint
bun run lint
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

## Architecture

```
manager/
├── app/
│   ├── api/              ← Backend: Route Handlers (replaces caddymgr Go server)
│   │   ├── auth/         ← POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
│   │   ├── caddy/        ← Caddy server/route management endpoints
│   │   └── admin/        ← Proxy catch-all to caddy-runtime gateway admin API
│   └── (dashboard)/      ← Frontend: App Router pages
├── components/           ← Shared UI components
├── hooks/                ← Custom React hooks
└── lib/
    ├── api.ts            ← Typed fetch helpers for backend API calls (frontend side)
    ├── auth.ts           ← localStorage session helpers
    ├── caddy-manager.ts  ← Caddy admin API client (server-side)
    └── gateway-proxy.ts  ← Gateway admin API proxy with session caching
```

- Frontend pages call the backend API via `lib/api.ts`; they do not contact Caddy or the gateway directly.
- `/api/admin/*` requests are proxied to the gateway admin API at `GATEWAY_ADDR`.
