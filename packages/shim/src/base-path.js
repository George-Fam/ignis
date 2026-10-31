// Lets Ignis run under a path prefix (a reverse proxy at /ignis/ with the prefix stripped).
// The app calls root-relative URLs, so they are rewritten here. Import this first.
const PREFIXES = ["/api/", "/assets/", "/vault-files/", "/ws"];

export const basePath = window.location.pathname.replace(/\/[^/]*$/, "");

function isAppPath(pathname) {
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function withBasePath(input) {
  if (!basePath) {
    return input;
  }

  const url = new URL(String(input), window.location.href);

  if (url.host !== window.location.host || !isAppPath(url.pathname)) {
    return input;
  }

  url.pathname = basePath + url.pathname;
  return url.toString();
}

function installBasePath() {
  window.__ignisBasePath = basePath;

  if (!basePath) {
    return;
  }

  const nativeFetch = window.fetch;

  window.fetch = function (input, init) {
    return input instanceof Request ? nativeFetch.call(this, new Request(withBasePath(input.url), input), init) : nativeFetch.call(this, withBasePath(input), init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return nativeOpen.call(this, method, withBasePath(url), ...rest);
  };

  const NativeWebSocket = window.WebSocket;

  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(withBasePath(url), protocols);
    }
  };
}

installBasePath();
