'use strict';

// Read only this project's freshly built release. Never inspect a live profile.
// Run: node scripts/audit-release.cjs [release-0.1.0-current]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const projectRoot = path.resolve(__dirname, '..');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseName = `release-${sourcePackage.version}-current`;
const releaseRoot = path.resolve(projectRoot, process.argv[2] || releaseName);
const reportPath = path.join(projectRoot, 'verification', 'package-audit.json');
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  version: sourcePackage.version,
  releaseDirectory: releaseName,
  passed: false,
  scope: 'Generated win-unpacked files, app.asar, app.asar.unpacked and installer hashes only',
  limitations: 'Static signatures cannot prove that every possible secret is absent. Installer hashes bind this audit to the corresponding build artifacts; the installer is not executed.',
  checks: [],
  findings: [],
  notices: [],
  inventories: { asar: [], unpacked: [], external: [] },
  artifacts: [],
};
const seenFindings = new Set();
const archiveFiles = new Map();
const unpackedFiles = new Map();
const packageManifests = new Map();
let archivePath;

function finding(rule, file) {
  const key = `${rule}:${file}`;
  if (!seenFindings.has(key)) {
    seenFindings.add(key);
    report.findings.push({ rule, file });
  }
}

function check(name, passed, file) {
  report.checks.push({ name, passed });
  if (!passed) finding(name, file);
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function slash(file) {
  return file.replaceAll('\\', '/');
}

function safeRelative(file) {
  return file && !file.startsWith('/') && !file.includes('\\') &&
    !file.split('/').some(part => part === '..' || part === '.') && !/^[a-z]:/i.test(file);
}

function inspectName(file, displayFile, applicationFile) {
  if (!safeRelative(file)) {
    finding('unsafe-package-path', displayFile);
    return;
  }
  const lower = file.toLowerCase();
  const parts = lower.split('/');
  const leaf = parts.at(-1);
  if (parts.some(part => /^(?:profiles?|cookies?|local ?storage|session ?storage|indexeddb|webstorage|partitions|code cache|gpucache|dawncache|preferences|testdata|test-data|\.test-data|verification|\.git|\.svn|\.hg|__tests__|fixtures|tests?)$/.test(part)) ||
      /^(?:cookies?(?:-journal|-wal|-shm)?|preferences(?:\.json)?|secure preferences|local state|media\.json|login data(?:-journal)?|web data(?:-journal)?|history(?:-journal)?|sessions?\.json)$/.test(leaf)) {
    finding('private-or-test-data-path', displayFile);
  }
  if (/\.map$/i.test(leaf)) finding('source-map', displayFile);
  if (/^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/.test(leaf) ||
      /\.(?:p12|pfx|key|pem)$/.test(leaf)) finding('credential-file-path', displayFile);
  if (parts.some(part => /^(?:\.cache|\.vscode|\.idea|coverage)$/.test(part))) finding('development-output-path', displayFile);
  if (applicationFile && !/^(?:(?:dist|dist-electron|vendor|node_modules)(?:\/|$)|build$|build\/icon\.ico$|package\.json$)/.test(file)) {
    finding('outside-application-whitelist', displayFile);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const localRootPattern = new RegExp(escapeRegex(slash(projectRoot)).replaceAll('/', '[\\\\/]+'), 'i');
const currentProfilePattern = process.env.USERPROFILE
  ? new RegExp(escapeRegex(slash(process.env.USERPROFILE)).replaceAll('/', '[\\\\/]+'), 'i')
  : null;
const genericPersonalPath = /\b[A-Z]:[\\/]+(?:Users|Documents and Settings|CodexData)[\\/]+[^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+/i;
const secretRules = [
  ['github-token-literal', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/],
  ['private-key-literal', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['aws-access-key-literal', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['api-key-literal', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['bearer-token-literal', /\bBearer\s+[A-Za-z0-9_+/.=-]{24,}/i],
  ['credential-assignment-literal', /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|client[_-]?secret)\b["']?\s*[:=]\s*["'][A-Za-z0-9_+/.=-]{24,}["']/i],
  ['developer-absolute-path', localRootPattern],
  ['local-codex-absolute-path', /\b[A-Z]:[\\/]+CodexData[\\/]/i],
];
if (currentProfilePattern) secretRules.push(['current-user-absolute-path', currentProfilePattern]);

function matchesUnchangedDependency(buffer, displayFile) {
  let source;
  const dependency = displayFile.match(/^(?:app\.asar\/|win-unpacked\/resources\/app\.asar\.unpacked\/)(node_modules\/.+)$/);
  if (dependency && safeRelative(dependency[1])) source = path.join(projectRoot, ...dependency[1].split('/'));
  if (displayFile === 'win-unpacked/LICENSES.chromium.html') source = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html');
  if (!source || !fs.existsSync(source) || fs.realpathSync(source) !== source) return false;
  return fs.readFileSync(source).equals(buffer);
}

function inspectContent(buffer, displayFile) {
  // UTF-8 covers JS/text and ASCII strings in binaries. UTF-16 also covers
  // native Windows strings. Match values are never persisted or printed.
  const encodings = [buffer.toString('utf8')];
  if (buffer.includes(0)) encodings.push(buffer.toString('utf16le'));
  for (const [rule, regex] of secretRules) {
    if (encodings.some(text => regex.test(text))) finding(rule, displayFile);
  }
  if (encodings.some(text => genericPersonalPath.test(text))) {
    // Dependencies ship documentation examples and upstream build references.
    // Only byte-identical project dependency files may become notices. The
    // current user's profile and local workspace rules above still fail.
    if (matchesUnchangedDependency(buffer, displayFile)) {
      report.notices.push({ rule: 'unchanged-upstream-path-reference', file: displayFile });
    } else {
      finding('personal-absolute-path', displayFile);
    }
  }
}

function fileRecord(file, buffer) {
  return { file, bytes: buffer.length, sha256: digest(buffer) };
}

function readArchive(file) {
  const entry = archiveFiles.get(file);
  if (!entry) return null;
  if (entry.unpacked) {
    const absolute = unpackedFiles.get(file);
    if (!absolute) throw new Error('Missing unpacked file');
    return fs.readFileSync(absolute);
  }
  return asar.extractFile(archivePath, path.normalize(file), false);
}

function walkDisk(directory, visit, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      finding('filesystem-link-not-followed', `win-unpacked/${relative}`);
    } else if (entry.isDirectory()) {
      inspectName(relative, `win-unpacked/${relative}`, false);
      walkDisk(absolute, visit, relative);
    } else if (entry.isFile()) {
      visit(relative, absolute);
    } else {
      finding('unexpected-filesystem-entry', `win-unpacked/${relative}`);
    }
  }
}

function requireArchiveFile(file) {
  check(`required:${file}`, archiveFiles.has(file) && archiveFiles.get(file).size > 0, `app.asar/${file}`);
}

function parseArchiveJson(file) {
  try {
    return JSON.parse(readArchive(file).toString('utf8'));
  } catch {
    // JSON parser messages can quote the input, so never output them.
    finding('invalid-or-missing-json', `app.asar/${file}`);
    return null;
  }
}

function resolvePackage(packageDirectory, dependency) {
  let directory = packageDirectory;
  while (true) {
    const candidate = directory ? `${directory}/node_modules/${dependency}` : `node_modules/${dependency}`;
    if (packageManifests.has(candidate)) return candidate;
    if (!directory) return null;
    directory = path.posix.dirname(directory);
    if (directory === '.') directory = '';
  }
}

function inspectProductionDependencies(packagedPackage) {
  for (const file of archiveFiles.keys()) {
    if (/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file)) {
      const manifest = parseArchiveJson(file);
      if (manifest) packageManifests.set(file.slice(0, -'/package.json'.length), manifest);
    }
  }
  const reachable = new Set();
  const queue = [{ directory: '', manifest: packagedPackage }];
  for (let index = 0; index < queue.length; index++) {
    const { directory, manifest } = queue[index];
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const dependency of Object.keys(dependencies)) {
      const resolved = resolvePackage(directory, dependency);
      if (!resolved) {
        if (!Object.hasOwn(manifest.optionalDependencies || {}, dependency)) {
          finding('missing-production-dependency', `${directory || 'app.asar'}/node_modules/${dependency}/package.json`);
        }
        continue;
      }
      if (!reachable.has(resolved)) {
        reachable.add(resolved);
        queue.push({ directory: resolved, manifest: packageManifests.get(resolved) });
      }
    }
  }
  for (const directory of packageManifests.keys()) {
    if (!reachable.has(directory)) finding('unneeded-or-development-package', `app.asar/${directory}/package.json`);
  }
  for (const file of archiveFiles.keys()) {
    const owner = file.match(/^(.*(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (owner && !packageManifests.has(owner[1])) finding('orphan-node-module-file', `app.asar/${file}`);
  }
  for (const dependency of Object.keys(sourcePackage.dependencies || {})) {
    if (!Object.hasOwn(packagedPackage.dependencies || {}, dependency)) {
      finding('missing-production-declaration', `app.asar/node_modules/${dependency}/package.json`);
    }
  }
  for (const dependency of Object.keys(sourcePackage.devDependencies || {})) {
    if (!(dependency in (sourcePackage.dependencies || {})) && packageManifests.has(`node_modules/${dependency}`)) {
      finding('direct-development-package', `app.asar/node_modules/${dependency}/package.json`);
    }
  }
  report.productionDependencyCount = reachable.size;
}

function audit() {
  // Restrict command-line input so this utility cannot accidentally traverse
  // arbitrary directories or real browser/application profiles.
  if (process.argv.length > 3 || releaseRoot !== path.join(projectRoot, releaseName)) {
    finding('unexpected-release-directory', releaseName);
    return;
  }
  const unpackedRoot = path.join(releaseRoot, 'win-unpacked');
  archivePath = path.join(unpackedRoot, 'resources', 'app.asar');
  if (!fs.existsSync(archivePath)) {
    finding('missing-app-archive', 'win-unpacked/resources/app.asar');
    return;
  }
  if (fs.realpathSync(unpackedRoot) !== unpackedRoot || fs.realpathSync(archivePath) !== archivePath || fs.lstatSync(archivePath).isSymbolicLink()) {
    finding('release-link-not-followed', 'win-unpacked/resources/app.asar');
    return;
  }
  report.archive = fileRecord('win-unpacked/resources/app.asar', fs.readFileSync(archivePath));
  for (const listed of asar.listPackage(archivePath)) {
    const file = slash(listed).replace(/^\/+/, '');
    const displayFile = `app.asar/${file}`;
    inspectName(file, displayFile, true);
    if (!safeRelative(file)) continue;
    const entry = asar.statFile(archivePath, path.normalize(file), false);
    if ('link' in entry) {
      finding('archive-link-not-followed', displayFile);
    } else if (!('files' in entry)) {
      archiveFiles.set(file, entry);
    }
  }
  walkDisk(unpackedRoot, (file, absolute) => {
    if (file === 'resources/app.asar') return;
    const displayFile = `win-unpacked/${file}`;
    inspectName(file, displayFile, false);
    const unpackedPrefix = 'resources/app.asar.unpacked/';
    const buffer = fs.readFileSync(absolute);
    if (file.startsWith(unpackedPrefix)) {
      const applicationFile = file.slice(unpackedPrefix.length);
      inspectName(applicationFile, displayFile, true);
      unpackedFiles.set(applicationFile, absolute);
      report.inventories.unpacked.push(fileRecord(applicationFile, buffer));
      inspectContent(buffer, displayFile);
    } else {
      report.inventories.external.push(fileRecord(file, buffer));
      // Electron's upstream binaries contain vendor build paths. Personal
      // content checks apply to app files and external readable documents.
      if (/\.(?:json|html?|md|txt|ya?ml|js|cjs|mjs|css|xml)$/i.test(file)) inspectContent(buffer, displayFile);
    }
  });
  for (const [file, entry] of archiveFiles) {
    if (entry.unpacked && !unpackedFiles.has(file)) {
      finding('missing-unpacked-file', `app.asar.unpacked/${file}`);
      continue;
    }
    const buffer = readArchive(file);
    report.inventories.asar.push({ ...fileRecord(file, buffer), unpacked: Boolean(entry.unpacked) });
    if (!entry.unpacked) inspectContent(buffer, `app.asar/${file}`);
  }
  for (const file of unpackedFiles.keys()) {
    if (!archiveFiles.get(file)?.unpacked) finding('unreferenced-unpacked-file', `app.asar.unpacked/${file}`);
  }

  for (const file of [
    'package.json', 'dist/index.html', 'dist-electron/electron/main.js',
    'dist-electron/electron/preload.js', 'dist-electron/electron/userscript-preload.js',
    'build/icon.ico', 'vendor/nodeseek-pro/manifest.json', 'vendor/nodeseek-pro/LICENSE',
    'vendor/nodeseek-pro/layui-license.txt', 'vendor/nodeseek-pro/highlight-license.txt',
    'node_modules/sharp/package.json', 'node_modules/sharp/dist/index.cjs',
    'node_modules/sharp/LICENSE', 'node_modules/@img/sharp-win32-x64/LICENSE',
    'node_modules/@img/sharp-win32-x64/package.json',
  ]) requireArchiveFile(file);
  const packagedPackage = parseArchiveJson('package.json');
  if (packagedPackage) {
    check('expected-package-version', packagedPackage.version === sourcePackage.version, 'app.asar/package.json');
    check('expected-entry-point', packagedPackage.main === 'dist-electron/electron/main.js', 'app.asar/package.json');
    check('expected-application-license', packagedPackage.license === 'GPL-3.0-only', 'app.asar/package.json');
    inspectProductionDependencies(packagedPackage);
  }
  const vendorManifest = parseArchiveJson('vendor/nodeseek-pro/manifest.json');
  if (vendorManifest) {
    for (const entry of vendorManifest.files || []) {
      if (typeof entry.name !== 'string' || !safeRelative(entry.name)) {
        finding('invalid-vendor-manifest-path', 'app.asar/vendor/nodeseek-pro/manifest.json');
        continue;
      }
      const file = `vendor/nodeseek-pro/${entry.name}`;
      requireArchiveFile(file);
      if (archiveFiles.has(file)) {
        const buffer = readArchive(file);
        check(`vendor-integrity:${entry.name}`, buffer.length === entry.bytes && digest(buffer) === entry.sha256, `app.asar/${file}`);
      }
    }
  }
  const nativeFiles = [...unpackedFiles.keys()].filter(file => /^node_modules\/@img\/sharp-win32-x64\/lib\//.test(file));
  check('sharp-native-addon-unpacked', nativeFiles.some(file => /\/sharp-win32-x64(?:-[\d.]+)?\.node$/.test(file)), 'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib');
  check('sharp-libvips-unpacked', nativeFiles.some(file => /\/libvips-\d+\.dll$/.test(file)), 'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib');
  check('sharp-libvips-cpp-unpacked', nativeFiles.some(file => /\/libvips-cpp-[\d.]+\.dll$/.test(file)), 'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib');
  for (const file of ['LICENSE-SeekDesk.txt', 'NOTICE.md', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    const absolute = path.join(unpackedRoot, file);
    check(`license:${file}`, fs.existsSync(absolute) && fs.statSync(absolute).size > 0, `win-unpacked/${file}`);
  }
  const expectedInstaller = `SeekDesk-Windows-${sourcePackage.version}-x64-Setup.exe`;
  const installerPath = path.join(releaseRoot, expectedInstaller);
  check('installer-exists', fs.existsSync(installerPath) && !fs.lstatSync(installerPath).isSymbolicLink(), expectedInstaller);
  if (fs.existsSync(installerPath) && !fs.lstatSync(installerPath).isSymbolicLink()) {
    report.artifacts.push(fileRecord(expectedInstaller, fs.readFileSync(installerPath)));
  }
}

try {
  audit();
} catch {
  // Do not print exceptions: third-party parser errors may include file data.
  finding('audit-could-not-complete', 'release-package');
}
report.findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
report.notices.sort((a, b) => a.file.localeCompare(b.file));
for (const inventory of Object.values(report.inventories)) inventory.sort((a, b) => a.file.localeCompare(b.file));
report.passed = report.findings.length === 0;
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Package audit ${report.passed ? 'PASSED' : 'FAILED'}: ${report.inventories.asar.length} archive files, ${report.inventories.unpacked.length} unpacked files, ${report.findings.length} findings, ${report.notices.length} upstream notices.`);
for (const issue of report.findings) console.error(`${issue.rule}: ${issue.file}`);
for (const notice of report.notices) console.log(`${notice.rule}: ${notice.file}`);
console.log('Report: verification/package-audit.json');
process.exitCode = report.passed ? 0 : 1;
