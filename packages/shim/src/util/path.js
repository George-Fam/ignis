// Canonical key form for fs paths: backslashes to forward slashes, no leading or trailing slash.
// Used by caches and registries that key on path.
let vaultPrefix = "";

function normalize(p) {
  const norm = (p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  if (vaultPrefix && norm === vaultPrefix) {
    return "";
  }

  return vaultPrefix && norm.startsWith(`${vaultPrefix}/`) ? norm.slice(vaultPrefix.length + 1) : norm;
}

// The vault's path as plugins see it. Paths under it are vault-relative everywhere else.
function setVaultPrefix(path) {
  vaultPrefix = "";
  vaultPrefix = normalize(path);
}

export { normalize, setVaultPrefix };
