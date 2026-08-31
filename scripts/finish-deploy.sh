#!/usr/bin/env bash
#
# The last mile, as one command.
#
#   ./scripts/finish-deploy.sh "postgresql://postgres.xxx:PASSWORD@...pooler.supabase.com:6543/postgres"
#
# Sets the connection string on Vercel, applies the schema, redeploys, and then
# proves the deployment works by running the acceptance suite against the live
# URL. Every step is checked, and it stops at the first failure rather than
# carrying on and reporting success at the end.
#
# The connection string is passed as an argument and never echoed, never
# written to a file in the repo, and never committed.

set -euo pipefail

CONNECTION_STRING="${1:-}"
DEPLOY_URL="${2:-https://recall-memory-demo.vercel.app}"

if [ -z "$CONNECTION_STRING" ]; then
  cat <<'USAGE'
Usage: ./scripts/finish-deploy.sh "<postgres connection string>" [deployment url]

Get the string from Supabase:
  Project Settings, then Database, then Connection string, then URI.
  Use the Transaction pooler tab on port 6543, not the direct connection.
  Replace [YOUR-PASSWORD] with your database password.
USAGE
  exit 1
fi

case "$CONNECTION_STRING" in
  postgres://*|postgresql://*) ;;
  *) echo "That does not look like a Postgres connection string. It should start with postgresql://" >&2; exit 1 ;;
esac

if printf '%s' "$CONNECTION_STRING" | grep -q "YOUR-PASSWORD"; then
  echo "The placeholder [YOUR-PASSWORD] is still in that string. Replace it with your database password." >&2
  exit 1
fi

if printf '%s' "$CONNECTION_STRING" | grep -qE ':5432/'; then
  echo "Note: that is the direct connection on port 5432. The pooled one on 6543 is what a serverless deployment wants."
  echo "Continuing anyway, since it will still work."
fi

echo
echo "1/4  Applying the schema"
DATABASE_URL="$CONNECTION_STRING" npm run migrate

echo
echo "2/4  Setting DATABASE_URL on Vercel"
# Remove any previous value first, otherwise `env add` refuses and the deploy
# below would quietly go out still pointing at nothing.
vercel env rm DATABASE_URL production --yes >/dev/null 2>&1 || true
printf '%s' "$CONNECTION_STRING" | vercel env add DATABASE_URL production >/dev/null
echo "     set (value not printed)"

echo
echo "3/4  Deploying"
vercel deploy --prod --yes >/dev/null
echo "     deployed"

echo
echo "     waiting for the deployment to answer as ready"
for attempt in $(seq 1 20); do
  status=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$DEPLOY_URL/api/health" || echo "000")
  if [ "$status" = "200" ]; then
    echo "     ready"
    break
  fi
  if [ "$attempt" = "20" ]; then
    echo "     still not ready after 20 tries. What it says about itself:" >&2
    curl -s -m 15 "$DEPLOY_URL/api/health" >&2 || true
    exit 1
  fi
  sleep 10
done

echo
echo "4/4  Proving it works, against the live URL"
npm run verify -- "$DEPLOY_URL"
