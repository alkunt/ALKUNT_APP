# Self-host release verification

- Built with Next.js 16.3.4, React 19.2.6, Node.js 24.19.0.
- Independent installation from package-lock.json; no workspace symlinks or Sites repository paths in the lock file.
- TypeScript and optimized production build passed.
- API, payment, authorization, storage, library isolation, and VAPID tests passed.
- Production HTTP integration passed for independent login, customer registration, session invalidation, header spoof rejection, CSRF, payment link delivery, manual payment confirmation, access grants, and library removal.
- Docker engine unavailable: Docker build/runtime not verified here.
- No browser automation available: visual, mobile keyboard and real-device push checks remain pending.
- No production credentials, owner password, customer database, or uploaded private files included.
- Source application remains unchanged; this is a separate export for Node.js/Docker.
