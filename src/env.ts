import { existsSync } from 'node:fs';

// Load .env for local runs (GitHub Actions provides real env vars).
if (existsSync('.env')) process.loadEnvFile('.env');
