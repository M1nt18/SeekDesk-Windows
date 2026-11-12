'use strict';

// Compile the real electron-builder NSIS templates with a tiny inert payload.
// Never execute the compiled output, an installer, or an uninstaller.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Initialize builder's public entry point before its internal target modules.
require('app-builder-lib');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const { nsisTemplatesDir } = require('app-builder-lib/out/targets/nsis/nsisUtil');
const { CancellationToken } = require('builder-util-runtime');

const projectRoot = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const options = metadata.build.nsis;
const outputRoot = path.join(projectRoot, 'verification', 'installer-options-compile');

async function main() {
  assert.equal(options.oneClick, false, 'Shortcut options require the assisted installer');
  assert.equal(options.include, 'build/installer.nsh');
  assert.equal(options.createDesktopShortcut, true);
  assert.equal(options.createStartMenuShortcut, true);
  fs.mkdirSync(outputRoot, { recursive: true });
  const payloadRoot = path.join(outputRoot, 'inert-payload');
  fs.mkdirSync(payloadRoot, { recursive: true });
  fs.writeFileSync(path.join(payloadRoot, 'not-an-application.txt'), 'Compile fixture only. Never execute the output.\n');
  const uninstallerFixture = path.join(outputRoot, 'not-an-uninstaller.txt');
  fs.writeFileSync(uninstallerFixture, 'Compile fixture only. Not executable.\n');

  let temporaryIndex = 0;
  const packager = {
    config: metadata.build,
    projectDir: projectRoot,
    appInfo: {
      productFilename: metadata.build.productName,
      sanitizedProductName: metadata.build.productName,
      updaterCacheDirName: 'seekdesk-compile-fixture',
    },
    info: {
      buildResourcesDir: path.join(projectRoot, 'build'),
      cancellationToken: new CancellationToken(),
    },
    debugLogger: { isEnabled: false },
    expandMacro: value => value.replaceAll('${productName}', metadata.build.productName).replaceAll('${version}', metadata.version),
    getTempFile: async name => path.join(outputRoot, `${++temporaryIndex}-${name}`),
    getResource: async (specified, fallback) => {
      const resource = specified ? path.resolve(projectRoot, specified) : path.join(projectRoot, 'build', fallback);
      return fs.existsSync(resource) ? resource : null;
    },
  };
  const target = Object.assign(Object.create(NsisTarget.prototype), {
    packager,
    options,
    name: 'nsis',
  });
  const header = await target.computeCommonInstallerScriptHeader();
  const template = fs.readFileSync(path.join(nsisTemplatesDir, 'installer.nsi'), 'utf8');
  const defines = {
    APP_ID: 'cc.seekdesk.compile-fixture',
    APP_GUID: 'seekdesk-compile-fixture-only',
    UNINSTALL_APP_KEY: 'seekdesk-compile-fixture-only',
    PRODUCT_NAME: metadata.build.productName,
    PRODUCT_FILENAME: metadata.build.productName,
    APP_FILENAME: metadata.build.productName,
    APP_DESCRIPTION: metadata.description,
    VERSION: metadata.version,
    PROJECT_DIR: projectRoot,
    BUILD_RESOURCES_DIR: path.join(projectRoot, 'build'),
    APP_PACKAGE_NAME: metadata.name,
    APP_BUILD_DIR: payloadRoot,
    UNINSTALLER_OUT_FILE: uninstallerFixture,
  };
  target.configureDefinesForAllTypeOfInstaller(defines);
  await target.configureDefines(false, defines);
  const licence = path.resolve(projectRoot, options.license);
  const script = `${header}\n!macro licensePage\n!insertmacro MUI_PAGE_LICENSE "${licence}"\n!macroend\n${template}`;

  // These methods call makensis only. Deliberately do not call buildInstaller or
  // computeScriptAndSignUninstaller, which execute a bootstrap EXE when building.
  for (const kind of ['installer', 'uninstaller']) {
    const output = path.join(outputRoot, `${kind}-compile-only.bin`);
    const currentDefines = { ...defines };
    if (kind === 'uninstaller') currentDefines.BUILD_UNINSTALLER = null;
    await target.executeMakensis(currentDefines, {
      OutFile: `"${output}"`,
      Unicode: true,
      SetCompressor: 'zlib',
    }, script, { skipSizeVerification: true });
    assert.ok(fs.statSync(output).size > 0, `${kind} compilation produced an artifact`);
  }
  fs.writeFileSync(path.join(outputRoot, 'report.json'), `${JSON.stringify({
    passed: true,
    mode: 'compile-only',
    installerExecuted: false,
    uninstallerExecuted: false,
    registryModified: false,
    electronBuilderVersion: require('electron-builder/package.json').version,
    checks: ['assisted installer with shortcut options compiles', 'standard uninstaller still compiles'],
    limitations: 'Compilation validates the actual NSIS hooks and page wiring; shortcut creation and visual layout were not executed on Windows.',
  }, null, 2)}\n`);
  console.log('Installer shortcut options: installer and uninstaller NSIS compilation passed. No installer or uninstaller was run.');
  console.log(`Report: ${path.relative(projectRoot, path.join(outputRoot, 'report.json'))}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
