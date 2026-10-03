import { defineConfig } from 'vitepress'

const site = 'https://shipwick.com'
const repo = 'https://github.com/shipwick/shipwick'
const version = '0.5.0'

export default defineConfig({
  lang: 'en-US',
  title: 'Shipwick',
  titleTemplate: ':title · Shipwick',
  description: 'Deploy Docker applications to your own Linux server: rolling deployments with health checks and rollback, HTTPS, jobs, backups, secrets and a dashboard, from one small file.',

  cleanUrls: true,
  sitemap: { hostname: site },

  // Illustrations are plain files in public/img, referenced by their address.
  // Without this the production build treats every absolute <img src> as a
  // module import and fails when a file is not there yet.
  vue: { template: { transformAssetUrls: { includeAbsolute: false } } },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Shipwick' }],
    ['meta', { property: 'og:image', content: `${site}/og.png` }],
    ['meta', { property: 'og:image:width', content: '1280' }],
    ['meta', { property: 'og:image:height', content: '640' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  // What a link preview shows is the page that was shared, not the home page:
  // title, description and address are written per page.
  transformHead({ pageData, title, description }) {
    if (pageData.isNotFound) return []
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    const url = `${site}/${path}`
    const head = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
    ]
    // The home page says what Shipwick is in the vocabulary search engines
    // index: a piece of software, its site, where the code is.
    if (pageData.relativePath === 'index.md') {
      head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Shipwick',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux',
        description,
        url: site,
        downloadUrl: `/releases`,
        softwareVersion: version,
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        sameAs: [repo],
      })])
    }
    return head
  },

  themeConfig: {
    logo: { src: '/img/wick.svg', alt: '' },

    nav: [
      { text: 'Documentation', link: '/docs/', activeMatch: '^/docs/(?!reference/)' },
      { text: 'Reference', link: '/docs/reference/deploy-yaml', activeMatch: '^/docs/reference/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'Releases', link: `${repo}/releases` },
          { text: 'Roadmap', link: `${repo}/blob/main/ROADMAP.md` },
        ],
      },
    ],

    sidebar: {
      '/docs/': [
        {
          text: 'Getting started',
          items: [
            { text: 'What is Shipwick?', link: '/docs/' },
            { text: 'How it fits together', link: '/docs/getting-started/how-it-fits' },
            { text: 'Install on a server', link: '/docs/getting-started/install' },
            { text: 'Install the CLI', link: '/docs/getting-started/install-cli' },
            { text: 'Your first deployment', link: '/docs/getting-started/first-deployment' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Architecture', link: '/docs/concepts/overview' },
            { text: 'Deployments', link: '/docs/concepts/deployments' },
            { text: 'Rollback', link: '/docs/concepts/rollback' },
            { text: 'Health checks and supervision', link: '/docs/concepts/health-and-supervision' },
            { text: 'Routing and HTTPS', link: '/docs/concepts/routing-and-https' },
            { text: 'Resource limits and metrics', link: '/docs/concepts/resources' },
            { text: 'Security', link: '/docs/security' },
          ],
        },
        {
          text: 'Tasks',
          items: [
            { text: 'Deploy from CI', link: '/docs/tasks/deploy-from-ci' },
            { text: 'Roll back and redeploy', link: '/docs/tasks/roll-back' },
            { text: 'See what is running', link: '/docs/tasks/inspect-and-logs' },
            { text: 'Use the dashboard', link: '/docs/tasks/dashboard' },
            { text: 'Pull from private registries', link: '/docs/tasks/private-registries' },
            { text: 'Call one application from another', link: '/docs/tasks/call-another-application' },
            { text: 'Run a stateful application', link: '/docs/tasks/stateful-applications' },
            { text: 'Expose a service that is not HTTP', link: '/docs/tasks/non-http-services' },
            { text: 'Serve several hostnames and redirect www', link: '/docs/tasks/several-hostnames' },
            { text: 'Share a hostname by path and configure the proxy', link: '/docs/tasks/paths-and-proxy' },
            { text: 'Put Cloudflare in front of the server', link: '/docs/tasks/cloudflare' },
            { text: 'Use a certificate of your own', link: '/docs/tasks/certificates' },
            { text: 'See what the proxy served', link: '/docs/tasks/traffic' },
            { text: 'Run scheduled jobs and one-off commands', link: '/docs/tasks/jobs' },
            { text: 'Back up and restore volumes', link: '/docs/tasks/backups' },
            { text: 'Move to a new server', link: '/docs/tasks/move-to-a-new-server' },
            { text: 'Create tokens for CI and teammates', link: '/docs/tasks/tokens' },
            { text: 'Rotate the encryption key', link: '/docs/tasks/rotate-the-encryption-key' },
            { text: 'Get notified', link: '/docs/tasks/notifications' },
            { text: 'Get alerts and scrape metrics', link: '/docs/tasks/alerts-and-metrics' },
            { text: 'Upgrade Shipwick', link: '/docs/tasks/upgrade' },
            { text: 'Reach the API without a hostname', link: '/docs/tasks/access-without-a-hostname' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'deploy.yaml', link: '/docs/reference/deploy-yaml' },
            { text: 'shipwick CLI', link: '/docs/reference/cli' },
            { text: 'Agent configuration', link: '/docs/reference/agent-configuration' },
            { text: 'REST API', link: '/docs/reference/api' },
          ],
        },
      ],
    },

    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: 'https://github.com/shipwick/website/edit/main/src/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the <a href="https://github.com/shipwick/shipwick/blob/main/LICENSE">Apache License 2.0</a>.',
      copyright: 'Copyright © 2026 The Shipwick Authors',
    },
  },
})
