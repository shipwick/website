# shipwick.com

The website and documentation of [Shipwick](https://github.com/shipwick/shipwick),
built with [VitePress](https://vitepress.dev) and served by Cloudflare Pages.

```bash
npm ci
npm run dev       # http://localhost:5173
npm run build     # → src/.vitepress/dist; fails on dead links
npm run preview
```

## Layout

| Path | |
|---|---|
| `src/index.md` | The home page |
| `src/docs/` | The documentation: `getting-started/`, `concepts/`, `tasks/`, `reference/` |
| `src/.vitepress/config.ts` | Navigation, sidebar, site metadata |
| `src/.vitepress/theme/` | The default theme with Shipwick's colors and the home page's styles |
| `src/public/` | Copied as is: icons, `_headers`, `_routes.json` |
| `functions/_middleware.js` | `get.shipwick.com` (see below) |

A new page needs an entry in the sidebar in `config.ts`.

## Writing

The documentation describes what the released version does. The code and the
`README.md` and `docs/` of the main repository are the authority: a command,
flag, default or number that cannot be found there does not belong here.
Plain language, second person, present tense; no marketing.

## get.shipwick.com

`curl -fsSL https://get.shipwick.com | sh` must receive the installer, not a web
page. Both hostnames are custom domains of the same Pages project;
`functions/_middleware.js` redirects requests for `get.shipwick.com` to
`scripts/install.sh` in the main repository, or, for a browser, to the
installation guide. The installer is never copied here. `_routes.json` limits
the function to `/`, so that ordinary page views do not invoke it.

## Deployment

Cloudflare Pages, connected to this repository:

| Setting | Value |
|---|---|
| Framework preset | VitePress |
| Build command | `npm run build` |
| Build output directory | `src/.vitepress/dist` |
| Node.js | from `.node-version` |
| Custom domains | `shipwick.com`, `get.shipwick.com` |

Every push to `main` is deployed; pull requests get preview URLs.

## License

[Apache License 2.0](LICENSE).
