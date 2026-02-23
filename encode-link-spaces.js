#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const VAULT = process.cwd();

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === ".obsidian") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (p.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

const mdFiles = walk(VAULT);

let updatedFiles = 0;
let updatedLinks = 0;

for (const f of mdFiles) {
  const original = fs.readFileSync(f, "utf8");
  let text = original;

  text = text.replace(/\[([^\]\n]+?)\]\(([^)\n]+?)\)/g, (m, label, href) => {
    const h = href.trim();
    if (/^(https?:|mailto:|tel:)/i.test(h)) return m;

    // preserve fragments. only encode spaces in the path part
    const parts = h.split("#");
    const base = parts[0];
    const frag = parts.length > 1 ? "#" + parts.slice(1).join("#") : "";

    if (!base.includes(" ")) return m;

    updatedLinks += 1;
    return `[${label}](${base.replace(/ /g, "%20")}${frag})`;
  });

  if (text !== original) {
    fs.writeFileSync(f + ".bak", original, "utf8");
    fs.writeFileSync(f, text, "utf8");
    updatedFiles += 1;
  }
}

console.log(`Updated files: ${updatedFiles}`);
console.log(`Updated links: ${updatedLinks}`);
