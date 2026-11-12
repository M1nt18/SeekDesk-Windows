'use strict';

// Static inspection only. Never execute the installer or read a live profile.
// Run: node scripts/check-installer.cjs [release-0.1.0-current]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

const projectRoot = path.resolve(__dirname, '..');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseName = `release-${sourcePackage.version}-current`;
const releaseRoot = path.resolve(projectRoot, process.argv[2] || releaseName);
const installerName = `SeekDesk-Windows-${sourcePackage.version}-x64-Setup.exe`;
const installerPath = path.join(releaseRoot, installerName);
const unpackedRoot = path.join(releaseRoot, 'win-unpacked');
const applicationName = `${sourcePackage.build.productName}.exe`;
const sevenZip = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe');
const verificationRoot = path.join(projectRoot, 'verification');
const auditRoot = path.join(verificationRoot, 'installer-payload-audit');
const reportPath = path.join(verificationRoot, 'installer-payload-report.json');
const payloadName = '$PLUGINSDIR/app-64.7z';
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  version: sourcePackage.version,
  releaseDirectory: releaseName,
  passed: false,
  mode: 'static-only',
  installerExecuted: false,
  scope: 'NSIS archive listing, isolated payload extraction, all payload files compared with win-unpacked, and PE metadata',
  limitations: 'No installation, registry, shortcut, application launch, user-profile access, or signature trust validation is performed. An empty PE certificate directory is reported as unsigned.',
  checks: [],
  findings: [],
  artifacts: [],
  pe: [],
  inventories: { installerPayload: [], winUnpacked: [] },
  comparison: { missingFromPayload: [], extraInPayload: [], different: [] },
};

function check(name, passed) {
  report.checks.push({ name, passed: Boolean(passed) });
  if (!passed) report.findings.push({ rule: name });
  return passed;
}

function fail(rule) {
  if (!report.findings.some(finding => finding.rule === rule)) report.findings.push({ rule });
}

function slash(file) {
  return file.replaceAll('\\', '/');
}

function relative(file) {
  return slash(path.relative(projectRoot, file));
}

function contained(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function safeArchivePath(file) {
  const normalized = slash(file).replace(/\/$/, '');
  return normalized.length > 0 && !normalized.startsWith('/') && !/[:\0\r\n]/.test(normalized) &&
    normalized.split('/').every(part => part !== '' && part !== '.' && part !== '..' &&
      !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function assertRegularFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || path.resolve(fs.realpathSync(file)) !== file) {
    throw new Error('unexpected-filesystem-entry');
  }
  return info;
}

function assertDirectory(directory) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(fs.realpathSync(directory)) !== directory) {
    throw new Error('unexpected-filesystem-entry');
  }
}

function record(file, name) {
  assertRegularFile(file);
  const data = fs.readFileSync(file);
  return { file: name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

function runSevenZip(args, step) {
  const result = spawnSync(sevenZip, args, {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180000,
  });
  // Never print parser output or exception messages, which could contain data.
  if (result.error || result.signal || result.status !== 0) {
    fail(step);
    throw new Error('archive-command-failed');
  }
  return result.stdout;
}

function listArchive(file, step) {
  const output = runSevenZip(['l', '-slt', '-sccUTF-8', '--', file], step);
  const separator = output.search(/^----------\r?$/m);
  if (separator < 0) throw new Error('archive-listing-unrecognized');
  const entries = output.slice(separator).split(/\r?\n\r?\n/).flatMap(block => {
    const values = new Map();
    for (const line of block.split(/\r?\n/)) {
      const split = line.indexOf(' = ');
      if (split >= 0) values.set(line.slice(0, split), line.slice(split + 3));
    }
    const archivePath = values.get('Path');
    if (!archivePath) return [];
    return [{
      file: slash(archivePath).replace(/\/$/, ''),
      directory: values.get('Folder') === '+' || /^D/.test(values.get('Attributes') || ''),
      link: values.has('Symbolic Link') || values.has('Hard Link') || /^L/.test(values.get('Attributes') || ''),
      bytes: /^\d+$/.test(values.get('Size') || '') ? Number(values.get('Size')) : null,
    }];
  });
  const seen = new Set();
  let safe = entries.length > 0;
  for (const entry of entries) {
    const folded = entry.file.toLowerCase();
    if (!safeArchivePath(entry.file) || entry.link || seen.has(folded)) safe = false;
    seen.add(folded);
  }
  if (!check(`${step}:safe-paths-and-no-links`, safe)) throw new Error('unsafe-archive-paths');
  return entries;
}

function inventory(root) {
  assertDirectory(root);
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (!safeArchivePath(name) || stat.isSymbolicLink() || !contained(root, absolute)) throw new Error('unsafe-extracted-entry');
      if (stat.isDirectory()) {
        assertDirectory(absolute);
        walk(absolute, name);
      } else if (stat.isFile()) {
        files.push(record(absolute, name));
      } else {
        throw new Error('unexpected-filesystem-entry');
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

function numericVersion(ms, ls) {
  return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.');
}

function inspectPE(file, role) {
  const binary = fs.readFileSync(file);
  const executable = NtExecutable.from(binary, { ignoreCert: true });
  const machine = executable.newHeader.fileHeader.machine;
  const certificate = executable.newHeader.optionalHeaderDataDirectory.get(4);
  const resources = NtExecutableResource.from(executable);
  const versions = Resource.VersionInfo.fromEntries(resources.entries).map(version => ({
    fileVersion: numericVersion(version.fixedInfo.fileVersionMS, version.fixedInfo.fileVersionLS),
    productVersion: numericVersion(version.fixedInfo.productVersionMS, version.fixedInfo.productVersionLS),
    fileVersionStrings: version.getAllLanguagesForStringValues().map(language => {
      const value = version.getStringValues(language).FileVersion;
      // Keep only numeric version metadata, never arbitrary resource strings.
      return typeof value === 'string' && /^\d+(?:\.\d+){2,3}$/.test(value) ? value : null;
    }),
  }));
  const unsigned = certificate.virtualAddress === 0 && certificate.size === 0;
  const expectedVersion = sourcePackage.version.split('.').slice(0, 3).concat('0').join('.');
  const expectedStrings = [sourcePackage.version, expectedVersion];
  const metadata = {
    role,
    file: role === 'installer' ? installerName : `win-unpacked/${applicationName}`,
    machine: `0x${machine.toString(16)}`,
    architecture: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : 'other',
    optionalHeader: executable.is32bit() ? 'PE32' : 'PE32+',
    versions,
    certificateDirectory: {
      offset: certificate.virtualAddress,
      bytes: certificate.size,
      status: unsigned ? 'unsigned' : 'certificate-directory-present-unverified',
    },
  };
  report.pe.push(metadata);
  check(`${role}:expected-machine`, role === 'application' ? machine === 0x8664 && !executable.is32bit() : machine === 0x14c || machine === 0x8664);
  check(`${role}:expected-file-version`, versions.length > 0 && versions.every(version =>
    version.fileVersion === expectedVersion && version.fileVersionStrings.length > 0 &&
    version.fileVersionStrings.every(value => expectedStrings.includes(value))));
  check(`${role}:unsigned-certificate-directory`, unsigned);
}

function audit() {
  if (!check('expected-release-directory', process.argv.length <= 3 && releaseRoot === path.join(projectRoot, releaseName))) return;
  assertDirectory(projectRoot);
  assertDirectory(releaseRoot);
  assertDirectory(unpackedRoot);
  assertRegularFile(installerPath);
  assertRegularFile(sevenZip);
  report.artifacts.push(record(installerPath, installerName));
  inspectPE(installerPath, 'installer');
  inspectPE(path.join(unpackedRoot, applicationName), 'application');

  const installerEntries = listArchive(installerPath, 'installer-list');
  report.installerEntries = installerEntries;
  const payloadEntries = installerEntries.filter(entry => entry.file === payloadName && !entry.directory);
  if (!check('exactly-one-x64-payload-archive', payloadEntries.length === 1 && payloadEntries[0].bytes > 0)) return;
  check('no-other-architecture-payload', !installerEntries.some(entry => /(?:^|\/)app-(?:32|arm64)\.7z$/i.test(entry.file)));

  fs.mkdirSync(verificationRoot, { recursive: true });
  assertDirectory(verificationRoot);
  fs.mkdirSync(auditRoot, { recursive: true });
  assertDirectory(auditRoot);
  const runRoot = fs.mkdtempSync(path.join(auditRoot, `${sourcePackage.version}-`));
  assertDirectory(runRoot);
  if (!contained(projectRoot, runRoot)) throw new Error('unexpected-verification-directory');
  report.extractionDirectory = relative(runRoot);
  const containerRoot = path.join(runRoot, 'container');
  const payloadRoot = path.join(runRoot, 'payload');
  fs.mkdirSync(containerRoot);
  fs.mkdirSync(payloadRoot);
  runSevenZip(['x', '-y', '-bd', '-bb0', '-sccUTF-8', `-o${containerRoot}`, '--', installerPath, payloadName], 'extract-installer-payload');
  const payloadArchive = path.join(containerRoot, '$PLUGINSDIR', 'app-64.7z');
  assertRegularFile(payloadArchive);
  report.artifacts.push(record(payloadArchive, payloadName));
  check('embedded-payload-size', fs.statSync(payloadArchive).size === payloadEntries[0].bytes);
  const listedPayload = listArchive(payloadArchive, 'payload-list');
  runSevenZip(['x', '-y', '-bd', '-bb0', '-sccUTF-8', `-o${payloadRoot}`, '--', payloadArchive], 'extract-application-payload');
  report.inventories.installerPayload = inventory(payloadRoot);
  report.inventories.winUnpacked = inventory(unpackedRoot);
  const actual = new Map(report.inventories.installerPayload.map(file => [file.file, file]));
  const expected = new Map(report.inventories.winUnpacked.map(file => [file.file, file]));
  const listedFiles = listedPayload.filter(entry => !entry.directory);
  check('payload-list-matches-extracted-file-count', listedFiles.length === actual.size);
  check('payload-list-matches-extracted-file-sizes', listedFiles.every(file => actual.get(file.file)?.bytes === file.bytes));
  for (const [file, expectedFile] of expected) {
    const actualFile = actual.get(file);
    if (!actualFile) report.comparison.missingFromPayload.push(file);
    else if (actualFile.bytes !== expectedFile.bytes || actualFile.sha256 !== expectedFile.sha256) report.comparison.different.push(file);
  }
  for (const file of actual.keys()) if (!expected.has(file)) report.comparison.extraInPayload.push(file);
  check('payload-matches-win-unpacked-paths-sizes-and-sha256', expected.size > 0 &&
    report.comparison.missingFromPayload.length === 0 && report.comparison.extraInPayload.length === 0 && report.comparison.different.length === 0);
  report.comparison.payloadFileCount = actual.size;
  report.comparison.winUnpackedFileCount = expected.size;
  report.comparison.totalPayloadBytes = report.inventories.installerPayload.reduce((sum, file) => sum + file.bytes, 0);
}

try {
  audit();
} catch {
  // Third-party errors may quote raw archive data; save only a fixed rule name.
  fail('installer-static-audit-could-not-complete');
}
report.passed = report.findings.length === 0;
fs.mkdirSync(verificationRoot, { recursive: true });
assertDirectory(verificationRoot);
if (fs.existsSync(reportPath)) assertRegularFile(reportPath);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Installer static audit ${report.passed ? 'PASSED' : 'FAILED'}: ${report.comparison.payloadFileCount || 0} payload files, ${report.findings.length} findings.`);
for (const finding of report.findings) console.error(finding.rule);
console.log('Report: verification/installer-payload-report.json');
process.exitCode = report.passed ? 0 : 1;
