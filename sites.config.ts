import { defineConfig } from './src/config.js';

/**
 * One entry per site. Run one:  npm run qa -- --site example
 *                    Run all:  npm run qa
 */
export default defineConfig([
  {
    name: 'example',
    baseUrl: 'https://example.com',
    pages: ['/'],
    crawl: { sitemap: true, followLinks: true, maxPages: 25, exclude: ['^/wp-admin', '^/cart', '\\?'] },
    tracking: {
      // Fill in your real IDs. A missing OR wrong ID fails the check.
      // gtm: ['GTM-XXXXXXX'],
      // ga4: ['G-XXXXXXXXXX'],
      // metaPixel: ['1234567890'],
      // callrail: { companyId: '123456789' },
      // custom: [{ name: 'LinkedIn Insight', pattern: 'snap\\.licdn\\.com' }],
    },
    // consentSelector: '#cookie-accept',
    content: {
      ignoreWords: ['Adheft'],
      // phones: ['5551234567'],
    },
    links: { external: true, ignore: ['linkedin\\.com'] },
    allowNoindex: ['/thank-you'],
  },
]);
