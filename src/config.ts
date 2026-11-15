import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { SiteConfig } from './types.js';

export function defineConfig(sites: SiteConfig[]): SiteConfig[] {
  return sites;
}

export async function loadConfig(file = 'sites.config.ts'): Promise<SiteConfig[]> {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const sites: SiteConfig[] = mod.default;
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error(`${file} must default-export a non-empty array of sites`);
  }
  for (const s of sites) {
    if (!s.name || !s.baseUrl) throw new Error(`Each site needs "name" and "baseUrl"`);
    s.baseUrl = s.baseUrl.replace(/\/+$/, '');
    new URL(s.baseUrl); // validate
  }
  return sites;
}
