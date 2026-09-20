// get.shipwick.com is what `curl -fsSL https://get.shipwick.com | sh` downloads.
// The installer lives in the main repository, where it is linted and tested;
// this only points at it, so there is never a second copy to keep in sync.
// A browser asking for the same address gets the installation guide instead.

const INSTALLER = 'https://raw.githubusercontent.com/shipwick/shipwick/main/scripts/install.sh'
const GUIDE = 'https://shipwick.com/docs/getting-started/install'

export function onRequest({ request, next }) {
  const { hostname } = new URL(request.url)
  if (hostname !== 'get.shipwick.com') {
    return next()
  }
  const wantsPage = (request.headers.get('accept') || '').includes('text/html')
  return Response.redirect(wantsPage ? GUIDE : INSTALLER, 302)
}
