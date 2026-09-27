<template>
  <div class="sw-notfound">
    <img
      src="/img/wick-404.svg"
      alt="Wick, the Shipwick flame, looking for the page"
      width="250"
      height="160"
      onerror="if (!this.dataset.fallback) { this.dataset.fallback = '1'; this.src = '/img/wick-map.svg' } else { this.style.display = 'none' }"
    >
    <p class="code">404</p>
    <h1>There is no page at this address.</h1>
    <p>It may have moved with a release, or a letter in the address is off. The documentation index lists every page; the CLI reference has every command.</p>
    <p class="links">
      <a href="/docs/">Documentation</a>
      <a href="/docs/reference/cli">CLI reference</a>
      <a href="/">Home</a>
    </p>
  </div>
</template>
