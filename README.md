# hospitality-pos

Cloud-first hospitality POS. Staging + production on Render. M-Pesa Buy Goods (C2B).

## First-run (local)

    cp .env.example .env
    bash scripts/dev-db.sh up
    npm install
    npm run db:migrate
    npm run seed
    npm run dev

Health: `curl http://localhost:3000/health`

Login (seeded): `admin@demo.local` / `ChangeMe123!`

## M-Pesa sandbox

1. In `.env`, set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` from Daraja.
2. Expose local API publicly (ngrok) and set `MPESA_CONFIRMATION_URL` + `MPESA_VALIDATION_URL`.
3. Once logged in, `POST /mpesa/c2b/register-urls` to register callbacks with Safaricom.
4. `POST /mpesa/c2b/simulate` to fire a test Buy Goods transaction.

## CI/CD

- Every push to `main` → CI builds, tests, hashes every file in `dist/`, uploads artifacts.
- CI success → **Deploy Staging** triggers. It re-verifies the hash, deploys to Render,
  waits until `/health` reports the baked commit SHA, then runs smoke tests.
- Staging success → **Deploy Production** triggers. It requires reviewer approval,
  re-verifies the hash again, then promotes the same bytes.

## Safety rails

- DB is always UTC. Nairobi conversion only at the edge (`toNairobiISOString`).
- M-Pesa callbacks are idempotent (`UNIQUE(trans_id)` + `ON CONFLICT DO NOTHING`).
- `SAFARICOM_ALLOWED_CIDRS` empty = disabled (sandbox). Set in production.
- Production HSTS enabled automatically when `NODE_ENV=production`.
