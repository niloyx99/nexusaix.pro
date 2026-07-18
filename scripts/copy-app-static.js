/**
 * After Vite build, copy frontend/dist → /app so Hostinger/LiteSpeed
 * can serve the SPA when the Node process is briefly unavailable.
 * Without this, /app/ is an empty directory and returns HTTP 403.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");
const src = path.join(projectRoot, "frontend", "dist");
const dest = path.join(projectRoot, "app");

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.warn("copy-app-static: frontend/dist/index.html missing — skip");
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
copyRecursive(src, dest);

const appHtaccess = `Options -Indexes +FollowSymLinks
DirectoryIndex index.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /app/
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /app/index.html [L]
</IfModule>

<IfModule mod_headers.c>
  Header set Cache-Control "no-cache, no-store, must-revalidate" "expr=%{REQUEST_URI} =~ m#index\\.html$#"
</IfModule>
`;

fs.writeFileSync(path.join(dest, ".htaccess"), appHtaccess);
console.log(`copy-app-static: mirrored frontend/dist → ${dest}`);
