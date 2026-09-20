import { defineConfig } from 'vitepress'

const site = 'https://shipwick.com'
const repo = 'https://github.com/shipwick/shipwick'

export default defineConfig({
  lang: 'en-US',
  title: 'Shipwick',
  titleTemplate: ':title · Shipwick',
  description: 'Production deployments, without Kubernetes. Shipwick runs your Docker applications on your own server: health checks, zero-downtime deploys, rollbacks, resource limits and HTTPS, from one small config file.',

  cleanUrls: true,
  sitemap: { hostname: site },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
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
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
    ]
  },

  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: '' },

    nav: [
      { text: 'Documentation', link: '/docs/', activeMatch: '^/docs/(?!reference/)' },
      { text: 'Reference', link: '/docs/reference/deploy-yaml', activeMatch: '^/docs/reference/' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'Releases', link: `${repo}/releases` },
          { text: 'Roadmap', link: `${repo}#14-roadmap` },
        ],
      },
    ],

    sidebar: {
      '/docs/': [
        {
          text: 'Getting started',
          items: [
            { text: 'What is Shipwick?', link: '/docs/' },
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
