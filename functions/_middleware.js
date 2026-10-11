// get.shipwick.com is what `curl -fsSL https://get.shipwick.com | sh` downloads,
// and get.shipwick.com/windows what `irm https://get.shipwick.com/windows | iex`
// does. The installers live in the main repository, where they are linted and
// tested; this only points at them, so there is never a second copy to keep
// in sync. A browser asking for the same address gets the installation guide
// instead.

const INSTALLERS = {
  '/': 'https://raw.githubusercontent.com/shipwick/shipwick/main/scripts/install.sh',
  '/windows': 'https://raw.githubusercontent.com/shipwick/shipwick/main/scripts/install.ps1',
}
const GUIDES = {
  '/': 'https://shipwick.com/docs/getting-started/install',
  '/windows': 'https://shipwick.com/docs/getting-started/install-cli#windows',
}

export function onRequest({ request, next }) {
  const { hostname, pathname } = new URL(request.url)
  const installer = INSTALLERS[pathname]
  if (hostname !== 'get.shipwick.com' || !installer) {
    return next()
  }
  const wantsPage = (request.headers.get('accept') || '').includes('text/html')
  return Response.redirect(wantsPage ? GUIDES[pathname] : installer, 302)
}
