/**
 * ExtensionBookmarks - Build Script
 * Bundles ES modules with esbuild and copies static assets into dist/
 */

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

async function build() {
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('[Build] Bundling JavaScript entrypoints...');

  // Bundle Background, Popup, and Dashboard
  await esbuild.build({
    entryPoints: {
      'background': 'src/background/background.js',
      'popup': 'src/ui/popup/popup.js',
      'dashboard': 'src/ui/dashboard/dashboard.js'
    },
    bundle: true,
    format: 'esm',
    target: ['chrome100', 'firefox109'],
    outdir: 'dist',
    sourcemap: true,
    minify: false
  });

  console.log('[Build] Copying static assets...');

  // Copy icons
  const iconSrcDir = path.resolve('icons');
  const iconDistDir = path.resolve('dist/icons');
  if (!fs.existsSync(iconDistDir)) fs.mkdirSync(iconDistDir, { recursive: true });
  for (const file of fs.readdirSync(iconSrcDir)) {
    fs.copyFileSync(path.join(iconSrcDir, file), path.join(iconDistDir, file));
  }

  // Copy HTML & CSS
  fs.copyFileSync('src/ui/popup/popup.html', 'dist/popup.html');
  fs.copyFileSync('src/ui/popup/popup.css', 'dist/popup.css');
  fs.copyFileSync('src/ui/dashboard/dashboard.html', 'dist/dashboard.html');
  fs.copyFileSync('src/ui/dashboard/dashboard.css', 'dist/dashboard.css');

  // Generate dist/manifest.json adapted for bundled paths
  const rootManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf-8'));
  const distManifest = {
    ...rootManifest,
    background: {
      service_worker: 'background.js',
      type: 'module'
    },
    action: {
      ...rootManifest.action,
      default_popup: 'popup.html'
    },
    options_ui: {
      ...rootManifest.options_ui,
      page: 'dashboard.html'
    }
  };
  fs.writeFileSync('dist/manifest.json', JSON.stringify(distManifest, null, 2));

  // Adjust script paths in dist/popup.html and dist/dashboard.html
  let popupHtml = fs.readFileSync('dist/popup.html', 'utf-8');
  popupHtml = popupHtml.replace('../../../icons/', 'icons/');
  popupHtml = popupHtml.replace('src="popup.js"', 'src="popup.js"');
  fs.writeFileSync('dist/popup.html', popupHtml);

  let dashboardHtml = fs.readFileSync('dist/dashboard.html', 'utf-8');
  dashboardHtml = dashboardHtml.replace('../../../icons/', 'icons/');
  dashboardHtml = dashboardHtml.replace('src="dashboard.js"', 'src="dashboard.js"');
  fs.writeFileSync('dist/dashboard.html', dashboardHtml);

  console.log('[Build] Extension successfully bundled into ./dist/');
}

build().catch(err => {
  console.error('[Build Error]', err);
  process.exit(1);
});
