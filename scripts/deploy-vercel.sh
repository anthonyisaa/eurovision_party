#!/usr/bin/env bash
# Deploy the Next.js app to Vercel.
#
# Why this script exists: Vercel's monorepo deploys need a project-level
# rootDirectory setting that's only configurable via the dashboard, NOT via
# vercel.json or the CLI. Instead of relying on that, we use `pnpm deploy` to
# flatten the @eurojury/web workspace into a standalone /tmp dir with all
# workspace deps inlined, then deploy from there.
#
# Prerequisites:
#   - vercel CLI installed and authenticated (`vercel login`)
#   - project linked to anthonyisaas-projects/eurojury (it is, on Vercel)
#   - prod env vars set on the project:
#       NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_PARTY_ID
#     (added with `--no-sensitive` so Next can read them at build time)
#
# Usage: scripts/deploy-vercel.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${TMPDIR:-/tmp}/eurojury-deploy"

cd "$REPO_ROOT"

echo "→ Cleaning previous deploy dir..."
rm -rf "$DEPLOY_DIR"

echo "→ Flattening apps/web workspace via pnpm deploy..."
pnpm --filter @eurojury/web deploy --prod --legacy "$DEPLOY_DIR"

echo "→ Inlining workspace packages..."
mkdir -p "$DEPLOY_DIR/packages"
cp -R packages/db "$DEPLOY_DIR/packages/db"
cp -R packages/shared "$DEPLOY_DIR/packages/shared"

echo "→ Rewriting workspace:* refs to file: refs..."
sed -i '' \
  -e 's|"@eurojury/db": "workspace:\*"|"@eurojury/db": "file:./packages/db"|g' \
  -e 's|"@eurojury/shared": "workspace:\*"|"@eurojury/shared": "file:./packages/shared"|g' \
  "$DEPLOY_DIR/package.json"

echo "→ Flattening tsconfig.json (no longer extends ../../)..."
cat > "$DEPLOY_DIR/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "incremental": true,
    "noEmit": true,
    "jsx": "preserve",
    "allowJs": false,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@eurojury/db/*": ["./packages/db/*"],
      "@eurojury/shared": ["./packages/shared/src/index.ts"],
      "@eurojury/shared/*": ["./packages/shared/src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
JSON

echo "→ Writing vercel.json..."
cat > "$DEPLOY_DIR/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm install --no-audit --no-fund --legacy-peer-deps",
  "buildCommand": "next build",
  "outputDirectory": ".next"
}
JSON

echo "→ Linking project..."
cd "$DEPLOY_DIR"
vercel link --yes --project eurojury

echo "→ Deploying to production..."
vercel deploy --prod --yes

echo
echo "✓ Done. Visit: https://eurojury.vercel.app/"
