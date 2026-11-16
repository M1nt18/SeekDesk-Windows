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

// Specialize only the hook's small branch/assignment language to compile-time
// constants. makensis then checks its real conditions for each synthetic scope;
// no installer process, registry or hand-written mirror of the decisions runs.
function scopeDecisionProbe(hooks) {
  const body = hooks.match(/!macro customInstallMode\n([\s\S]*?)!macroend/)?.[1];
  assert.ok(body, 'The real update scope hook must exist');
  const lines = body.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith(';'));
  const scenarios = [
    { name: 'machine-only', update: 'true', machine: '1', user: '0', expectedMachine: 1, expectedUser: 0 },
    { name: 'user-only', update: 'true', machine: '0', user: '1', expectedMachine: 0, expectedUser: 1 },
    { name: 'both-copies', update: 'true', machine: '1', user: '1', expectedMachine: 0, expectedUser: 0 },
    { name: 'no-copy', update: 'true', machine: '0', user: '0', expectedMachine: 0, expectedUser: 0 },
    { name: 'fresh-machine', update: 'false', machine: '1', user: '0', expectedMachine: 0, expectedUser: 0 },
    { name: 'fresh-user', update: 'false', machine: '0', user: '1', expectedMachine: 0, expectedUser: 0 },
  ];
  return scenarios.map(scenario => {
    const values = { seekDeskIsUpdate: scenario.update, hasPerMachineInstallation: scenario.machine, hasPerUserInstallation: scenario.user };
    const condition = value => value.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (_match, variable) => {
      assert.ok(Object.hasOwn(values, variable), `Unexpected scope input: ${variable}`);
      return `"${values[variable]}"`;
    });
    const result = ['!define SEEKDESK_SCOPE_PROBE_MACHINE 0', '!define SEEKDESK_SCOPE_PROBE_USER 0'];
    const expressions = [...new Set(lines.flatMap(line => {
      const match = line.match(/^\$\{(?:if|elseIf|andIf)\}\s+(.+)$/i);
      return match ? [match[1]] : [];
    }))];
    for (let index = 0; index < expressions.length; index++) result.push(`!if ${condition(expressions[index])}`, `!define SEEKDESK_SCOPE_COND_${index} 1`, '!else', `!define SEEKDESK_SCOPE_COND_${index} 0`, '!endif');
    const constant = expression => `\${SEEKDESK_SCOPE_COND_${expressions.indexOf(expression)}}`;
    for (let index = 0; index < lines.length; index++) {
      const branch = lines[index].match(/^\$\{(if|elseIf)\}\s+(.+)$/i);
      if (branch) {
        const conditions = [constant(branch[2])];
        while (lines[index + 1]?.match(/^\$\{andIf\}\s+/i)) conditions.push(constant(lines[++index].replace(/^\$\{andIf\}\s+/i, '')));
        assert.ok(conditions.length <= 2, 'Scope probe must explicitly support any additional compound conditions');
        result.push(`${branch[1].toLowerCase() === 'if' ? '!if' : '!else if'} ${conditions.join(' && ')}`);
      } else if (/^\$\{endif\}$/i.test(lines[index])) result.push('!endif');
      else if (/^\$\{else\}$/i.test(lines[index])) result.push('!else');
      else {
        const assignment = lines[index].match(/^StrCpy \$(isForceMachineInstall|isForceCurrentInstall) "([01])"$/);
        assert.ok(assignment, `Unsupported update scope instruction: ${lines[index]}`);
        result.push(`!define /redef SEEKDESK_SCOPE_PROBE_${assignment[1] === 'isForceMachineInstall' ? 'MACHINE' : 'USER'} ${assignment[2]}`);
      }
    }
    result.push(`!if \${SEEKDESK_SCOPE_PROBE_MACHINE} != ${scenario.expectedMachine}`, `!error "Wrong machine update scope decision: ${scenario.name}"`, '!endif', `!if \${SEEKDESK_SCOPE_PROBE_USER} != ${scenario.expectedUser}`, `!error "Wrong user update scope decision: ${scenario.name}"`, '!endif', '!undef SEEKDESK_SCOPE_PROBE_MACHINE', '!undef SEEKDESK_SCOPE_PROBE_USER');
    result.push(...expressions.map((_value, index) => `!undef SEEKDESK_SCOPE_COND_${index}`));
    return result.join('\n');
  }).join('\n');
}

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

  // Probe the real template's hook expansion in a separate inert compile.
  // In particular, multiUserUi checks `customInstallmode` but inserts
  // `customInstallMode`; a mere source-string assertion cannot prove it works.
  const originalInclude = path.join(projectRoot, 'build', 'installer.nsh');
  const probeInclude = path.join(outputRoot, 'installer-hook-probe.nsh');
  const hooks = fs.readFileSync(originalInclude, 'utf8').replace(/\r\n/g, '\n');
  let probeHooks = hooks;
  const probeNames = ['customInstallMode', 'customPageAfterChangeDir', 'customFinishPage'];
  for (const name of probeNames) {
    const declaration = `!macro ${name}\n`;
    assert.ok(probeHooks.includes(declaration), `Missing ${name} declaration`);
    probeHooks = probeHooks.replace(declaration, `${declaration}    !define SEEKDESK_PROBE_${name}\n`);
  }
  fs.writeFileSync(probeInclude, probeHooks);
  const includeLine = `!include "${originalInclude}"`;
  assert.ok(script.includes(includeLine));
  const probeScript = script.replace(includeLine, `!include "${probeInclude}"`) + probeNames.map(name => `\n!ifndef SEEKDESK_PROBE_${name}\n!error "The actual builder template did not expand ${name}"\n!endif\n`).join('') + scopeDecisionProbe(hooks);
  const probeOutput = path.join(outputRoot, 'hook-expansion-compile-only.bin');
  await target.executeMakensis({ ...defines }, {
    OutFile: `"${probeOutput}"`, Unicode: true, SetCompressor: 'zlib',
  }, probeScript, { skipSizeVerification: true });
  assert.ok(fs.statSync(probeOutput).size > 0);

  // These methods call makensis only. Deliberately do not call buildInstaller or
  // computeScriptAndSignUninstaller, which execute a bootstrap EXE when building.
  for (const kind of ['installer', 'installer-all-users', 'installer-no-run-checkbox', 'uninstaller']) {
    const output = path.join(outputRoot, `${kind}-compile-only.bin`);
    const currentDefines = { ...defines };
    if (kind === 'uninstaller') currentDefines.BUILD_UNINSTALLER = null;
    if (kind === 'installer-all-users') currentDefines.INSTALL_MODE_PER_ALL_USERS = null;
    if (kind === 'installer-no-run-checkbox') currentDefines.HIDE_RUN_AFTER_FINISH = null;
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
    checks: ['assisted installer with first-install shortcut options compiles', 'per-machine installer keeps elevation-aware update path', 'first-install completion without run checkbox compiles', 'standard uninstaller still compiles', 'actual builder template expands update mode/progress/finish hooks despite mode-name case difference', 'actual scope hook conditions select only the single registered copy and retain selection for two/no copies and fresh installs'],
    limitations: 'Four real-template variants, a hook expansion probe and compile-time specialization of six synthetic scope cases validate NSIS syntax and page wiring. No installer, registry, shortcut, elevation prompt, file replacement, restart or visual layout was executed on Windows.',
  }, null, 2)}\n`);
  console.log('Installer update progress: four NSIS variants and actual hook expansion probe compile. No installer or uninstaller was run.');
  console.log(`Report: ${path.relative(projectRoot, path.join(outputRoot, 'report.json'))}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
