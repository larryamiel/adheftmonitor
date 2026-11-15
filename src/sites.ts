import './env.js';
import { loadConfig } from './config.js';
import { db, loadSitesFromDb, upsertSite } from './db.js';

const HELP = `
Manage monitored sites in the database (the dashboard will do this later).

  npm run sites -- list
  npm run sites -- add <name> <https://url>       add or update a site (crawls all pages)
  npm run sites -- set <name> '<json config>'     replace a site's config, e.g. '{"tracking":{"gtm":["GTM-ABC123"]}}'
  npm run sites -- enable|disable <name>
  npm run sites -- remove <name>                  deletes the site AND its run history
  npm run sites -- import [sites.config.ts]       upsert every site from a config file
  npm run sites -- matrix [names|ids|all]         JSON list of site IDs (used by GitHub Actions)
`;

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'list': {
      const sites = await loadSitesFromDb(true);
      const { data: enabled } = await db().from('sites').select('name,enabled');
      const on = new Map((enabled ?? []).map((r) => [r.name, r.enabled]));
      for (const s of sites) console.log(`${on.get(s.name) ? '●' : '○'} ${s.name.padEnd(24)} ${s.baseUrl}`);
      if (!sites.length) console.log('No sites yet. Add one: npm run sites -- add mysite https://www.mysite.com');
      break;
    }
    case 'add': {
      if (!a || !b) throw new Error('Usage: add <name> <url>');
      const url = new URL(b);
      const { data: existing } = await db().from('sites').select('config').eq('name', a).maybeSingle();
      await upsertSite({ ...(existing?.config ?? {}), name: a, baseUrl: url.origin });
      console.log(`Saved ${a} → ${url.origin}`);
      break;
    }
    case 'set': {
      if (!a || !b) throw new Error(`Usage: set <name> '<json>'`);
      const { error } = await db().from('sites').update({ config: JSON.parse(b), updated_at: new Date().toISOString() }).eq('name', a);
      if (error) throw new Error(error.message);
      console.log(`Updated config for ${a}`);
      break;
    }
    case 'enable':
    case 'disable': {
      const { error } = await db().from('sites').update({ enabled: cmd === 'enable' }).eq('name', a);
      if (error) throw new Error(error.message);
      console.log(`${cmd}d ${a}`);
      break;
    }
    case 'remove': {
      const { error } = await db().from('sites').delete().eq('name', a);
      if (error) throw new Error(error.message);
      console.log(`Removed ${a}`);
      break;
    }
    case 'import': {
      for (const s of await loadConfig(a ?? 'sites.config.ts')) {
        await upsertSite(s);
        console.log(`Imported ${s.name}`);
      }
      break;
    }
    case 'matrix': {
      // Prints site IDs (not names): job names and logs are public on a public repo.
      // Accepts names or IDs; "all" = every enabled site. Explicitly named sites run even if paused.
      const only = a && a !== 'all' ? a.split(',').map((s) => s.trim()) : undefined;
      const sites = await loadSitesFromDb(!!only);
      console.log(JSON.stringify(sites.filter((s) => !only || only.includes(s.name) || only.includes(s.id)).map((s) => s.id)));
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
