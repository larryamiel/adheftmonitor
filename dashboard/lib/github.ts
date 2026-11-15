import 'server-only';

export const githubConfigured = () => !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);

/** Starts .github/workflows/qa.yml via workflow_dispatch. */
export async function dispatchQa(opts: { site: string; pages?: string; links?: boolean }): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPO must be set to run QA from the dashboard');
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/qa.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ref: process.env.GITHUB_REF || 'main',
      inputs: { site: opts.site, pages: opts.pages ?? '', links: String(opts.links ?? true) },
    }),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
