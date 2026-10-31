const fs = require("fs");
const path = require("path");
const config = require("../config");

let cached = null;

// Obsidian loads its libraries and workers from root paths. Relative paths mean the
// same thing at / and also work when a reverse proxy serves Ignis under a prefix.
function buildObsidianApp() {
  if (!cached) {
    cached = fs
      .readFileSync(path.join(config.obsidianAssetsPath, "app.js"), "utf-8")
      .replace(/(["'`])\/lib\//g, "$1lib/")
      .replace(/(["'`])\/(sim|worker)\.js/g, "$1$2.js");
  }

  return cached;
}

module.exports = { buildObsidianApp };
