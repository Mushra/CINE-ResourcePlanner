// Compiles java/MppToJson.java and jlinks a minimal JRE, both into resources/mpp/ (gitignored —
// regenerated on every build, see .gitignore). resources/mpp/lib/*.jar (MPXJ + its runtime deps)
// IS committed and is left untouched here. See docs/INTEGRATIONS.md for why these specific steps
// exist and where the module list below came from.
//
// Requires a JDK 17+ on PATH or via JAVA_HOME (javac + jlink + jdeps). CI installs one via
// actions/setup-java; a local `npm run electron:build` needs one too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const JAVA_SRC = path.join(ROOT, 'java', 'MppToJson.java');
const LIB_DIR = path.join(ROOT, 'resources', 'mpp', 'lib');
const SHIM_DIR = path.join(ROOT, 'resources', 'mpp', 'shim');
const JRE_DIR = path.join(ROOT, 'resources', 'mpp', 'jre');

// Determined once via `jdeps --print-module-deps -R --class-path lib/* shim/MppToJson.class`
// against the compiled shim + vendored jars (see docs/INTEGRATIONS.md) — java.base/java.desktop/
// java.prefs/java.sql came back from that trace; jdk.charsets was added after jlink's default
// image failed at runtime on `Charset.forName("MacRoman")` (a dynamic lookup jdeps can't trace
// statically — MPXJ probes legacy Mac/Windows charsets for older .mpp files).
const JLINK_MODULES = 'java.base,java.desktop,java.prefs,java.sql,jdk.charsets';

function bin(javaHome, name) {
  return path.join(javaHome, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
}

function findJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  try {
    const javacPath = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['javac'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    return path.dirname(path.dirname(javacPath));
  } catch {
    throw new Error(
      'No JDK found (JAVA_HOME unset and javac not on PATH). The .mpp import feature needs a JDK ' +
        '17+ to compile the Java shim and jlink a bundled runtime — install one and re-run, or set JAVA_HOME.',
    );
  }
}

function main() {
  if (!existsSync(LIB_DIR)) {
    throw new Error(`${LIB_DIR} is missing — the vendored MPXJ jars should be committed to the repo.`);
  }

  const javaHome = findJavaHome();
  console.log(`Using JDK at ${javaHome}`);

  rmSync(SHIM_DIR, { recursive: true, force: true });
  rmSync(JRE_DIR, { recursive: true, force: true });
  mkdirSync(SHIM_DIR, { recursive: true });

  console.log('Compiling java/MppToJson.java...');
  execFileSync(bin(javaHome, 'javac'), ['-encoding', 'UTF-8', '-cp', path.join(LIB_DIR, '*'), '-d', SHIM_DIR, JAVA_SRC], { stdio: 'inherit' });

  console.log(`Linking a minimal JRE (${JLINK_MODULES})...`);
  execFileSync(
    bin(javaHome, 'jlink'),
    ['--add-modules', JLINK_MODULES, '--output', JRE_DIR, '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=zip-6'],
    { stdio: 'inherit' },
  );

  console.log('mpp runtime prepared: resources/mpp/{shim,jre}');
}

main();
