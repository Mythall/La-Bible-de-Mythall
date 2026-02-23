#!/usr/bin/env node
/**
 * Fix Obsidian links in a vault:
 * - Converts [[Page]] and [[Page|Text]] to [Text](relative/path/Page.md)
 * - Rewrites markdown links to correct relative path if target note exists elsewhere
 *
 * Limitations:
 * - Does not resolve heading links (#Heading) or block refs (^block) yet
 * - If multiple notes share the same basename (e.g. Notes/Page.md and Lore/Page.md),
 *   it reports as ambiguous and does not rewrite that link
 */

const fs = require("fs");
const path = require("path");

const VAULT = process.cwd();

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git") continue;
    if (ent.name === ".obsidian") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function normKey(s) {
  return s.trim().toLowerCase();
}

function relFromTo(fromFile, toFile) {
  const fromDir = path.dirname(fromFile);
  let rel = path.relative(fromDir, toFile);
  rel = rel.split(path.sep).join("/"); // posix
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function stripMdExt(s) {
  return s.replace(/\.md$/i, "");
}

// Build index: basename (without .md) -> [absolutePath]
const files = walk(VAULT);
const mdFiles = files.filter(f => f.toLowerCase().endsWith(".md"));

const index = new Map();
for (const f of mdFiles) {
  const base = stripMdExt(path.basename(f));
  const key = normKey(base);
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(f);
}

const report = {
  updatedFiles: 0,
  updatedLinks: 0,
  ambiguous: [],
  missing: [],
};

function resolveNote(name) {
  const key = normKey(stripMdExt(name));
  return index.get(key) || [];
}

// Rewrite one file
for (const f of mdFiles) {
  const original = fs.readFileSync(f, "utf8");
  let text = original;
  let changed = false;

  // 1) Convert wikilinks: [[Page]] or [[Page|Text]]
  // Also supports [[Folder/Page|Text]] by taking only the last path segment for lookup,
  // because many wikilinks are just titles.
  text = text.replace(/\[\[([^\]\n]+?)\]\]/g, (m, inner) => {
    // ignore embeds like ![[...]] (optional). If you use those and want them converted too, say so.
    // We will handle only plain wikilinks.
    const parts = inner.split("|");
    const targetRaw = parts[0].trim();
    const display = (parts[1] ?? parts[0]).trim();

    // remove heading or block refs for now
    const targetNoFrag = targetRaw.split("#")[0].split("^")[0].trim();

    // prefer basename segment for lookup
    const lookupName = targetNoFrag.split("/").pop();

    const matches = resolveNote(lookupName);
    if (matches.length === 1) {
      const rel = relFromTo(f, matches[0]);
      changed = true;
      report.updatedLinks += 1;
      return `[${display}](${rel})`;
    }
    if (matches.length > 1) {
      report.ambiguous.push({ file: f, link: m, candidates: matches.map(x => path.relative(VAULT, x)) });
      return m;
    }
    report.missing.push({ file: f, link: m });
    return m;
  });

  // 2) Fix markdown links that reference a note by filename but wrong path
  // Only rewrite links that end in .md (no http, no mailto, etc)
  text = text.replace(/\[([^\]\n]+?)\]\(([^)\n]+?)\)/g, (m, label, href) => {
    const h = href.trim();

    // skip external links
    if (/^(https?:|mailto:|tel:)/i.test(h)) return m;

    // skip anchors-only
    if (h.startsWith("#")) return m;

    // Only consider .md note links (strip query fragments)
    const hrefNoFrag = h.split("#")[0].split("^")[0];
    if (!hrefNoFrag.toLowerCase().endsWith(".md")) return m;

    const base = stripMdExt(path.basename(hrefNoFrag));
    const matches = resolveNote(base);
    if (matches.length === 1) {
      const rel = relFromTo(f, matches[0]);
      if (rel !== hrefNoFrag) {
        changed = true;
        report.updatedLinks += 1;
        // preserve any #heading fragment if present
        const frag = h.includes("#") ? "#" + h.split("#").slice(1).join("#") : "";
        return `[${label}](${rel}${frag})`;
      }
    } else if (matches.length > 1) {
      report.ambiguous.push({ file: f, link: m, candidates: matches.map(x => path.relative(VAULT, x)) });
    } else {
      // do nothing. Might be a real missing link or a file not in vault
    }
    return m;
  });

  if (changed) {
    fs.writeFileSync(f, text, "utf8");
    report.updatedFiles += 1;
  }
}

// Write report
const reportPath = path.join(VAULT, "link-fix-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(`Done. Updated files: ${report.updatedFiles}. Updated links: ${report.updatedLinks}.`);
console.log(`Ambiguous: ${report.ambiguous.length}. Missing wikilinks: ${report.missing.length}.`);
console.log(`Report: ${reportPath}`);
