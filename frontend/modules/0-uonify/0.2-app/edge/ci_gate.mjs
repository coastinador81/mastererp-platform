#!/usr/bin/env node
// ci_gate.mjs · Publica desde la CI las dos funciones de la puerta de https://dev.uonify.com sin tocar
// el KVS ni la distribución: el rol de la CI no puede leerlos. Fases:
//   node ci_gate.mjs plan                   solo lectura: compara el código LIVE con el de esta carpeta
//   node ci_gate.mjs publish [--backup d]   si algo difiere: guarda el código LIVE actual en d, sube el
//                                           de esta carpeta a DEVELOPMENT, lo prueba en el runtime real
//                                           (run_test_function.mjs --sin-claves-kvs) y, si todo da OK,
//                                           publica en LIVE solo las funciones que cambian
//   node ci_gate.mjs rollback --from d      vuelve a dejar en LIVE el código guardado por publish
// Los casos con credenciales buenas no se prueban aquí (la CI no las conoce): los cubre test_gate.mjs
// en local, con un KVS simulado. Sale con 1 si algo falla.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT = '277352717693';
const FUNCTIONS = [
  { key: 'd', name: 'uonify-dev-gate-default', file: 'gate-default.js' },
  { key: 'a', name: 'uonify-dev-gate-api', file: 'gate-api.js' },
];
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, fallback) => (argv.includes(name) && argv[argv.indexOf(name) + 1] ? argv[argv.indexOf(name) + 1] : fallback);
const say = (message) => console.log(message);
class Fatal extends Error {}
const fatal = (message) => {
  throw new Fatal(message);
};

function aws(args) {
  const r = spawnSync('aws', [...args, '--output', 'json'], { encoding: 'utf8', env: { ...process.env, AWS_PAGER: '' }, maxBuffer: 16 << 20 });
  if (r.error) fatal(`no puedo ejecutar la AWS CLI (${r.error.code})`);
  if (r.status !== 0) fatal(((r.stderr || '').match(/An error occurred \([A-Za-z0-9]+\)[^\n]*/) || [`aws ${args[0]} ${args[1]} ha fallado`])[0]);
  return r.stdout ? JSON.parse(r.stdout) : {};
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function checkAccount() {
  const id = aws(['sts', 'get-caller-identity']);
  if (id.Account !== ACCOUNT) fatal(`la AWS CLI apunta a la cuenta ${id.Account}, no a ${ACCOUNT}`);
}

function stageCode(name, stage, work) {
  const file = path.join(work, `${name}.${stage}.js`);
  aws(['cloudfront', 'get-function', '--name', name, '--stage', stage, file]);
  return fs.readFileSync(file);
}

function describe(name) {
  const d = aws(['cloudfront', 'describe-function', '--name', name, '--stage', 'DEVELOPMENT']);
  const cfg = d.FunctionSummary.FunctionConfig;
  if (cfg.Runtime !== 'cloudfront-js-2.0') fatal(`${name} usa ${cfg.Runtime}, no cloudfront-js-2.0`);
  return { etag: d.ETag, config: cfg };
}

// Sube un código a DEVELOPMENT conservando comentario, runtime y KVS asociado. Devuelve el ETag nuevo.
function toDevelopment(name, code, work) {
  const { etag, config } = describe(name);
  const file = path.join(work, `${name}.subir.js`);
  fs.writeFileSync(file, code);
  const cfgFile = path.join(work, `${name}.config.json`);
  fs.writeFileSync(cfgFile, JSON.stringify(config));
  const r = aws(['cloudfront', 'update-function', '--name', name, '--if-match', etag,
    '--function-config', 'file://' + cfgFile, '--function-code', 'fileb://' + file]);
  return r.ETag;
}

function runTests() {
  const r = spawnSync(process.execPath, [path.join(HERE, 'run_test_function.mjs'), '--default', FUNCTIONS[0].name,
    '--api', FUNCTIONS[1].name, '--stage', 'DEVELOPMENT', '--sin-claves-kvs'], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) fatal(`run_test_function.mjs no da OK en DEVELOPMENT (salida ${r.status}): no se publica nada`);
}

function publishLive(name) {
  const { etag } = describe(name);
  aws(['cloudfront', 'publish-function', '--name', name, '--if-match', etag]);
}

function status(work) {
  return FUNCTIONS.map((f) => {
    const local = fs.readFileSync(path.join(HERE, f.file));
    const live = stageCode(f.name, 'LIVE', work);
    const dev = stageCode(f.name, 'DEVELOPMENT', work);
    return { ...f, local, live, liveSame: sha256(live) === sha256(local), devSame: sha256(dev) === sha256(local) };
  });
}

function phasePlan(work) {
  const st = status(work);
  for (const s of st) {
    say(`${s.liveSame ? '=' : '~'} ${s.name}: LIVE ${s.liveSame ? 'igual a' : 'distinto de'} ${s.file} (LIVE ${sha256(s.live).slice(0, 12)} · local ${sha256(s.local).slice(0, 12)})`);
  }
  if (st.every((s) => s.liveSame)) say('Puerta: nada que publicar.');
  else say('Puerta: con «publish» se probará en DEVELOPMENT y se publicará lo que cambia.');
  return 0;
}

function phasePublish(work) {
  const st = status(work);
  const changed = st.filter((s) => !s.liveSame);
  if (!changed.length) {
    say('= Puerta: LIVE ya es el código de esta carpeta; nada que publicar.');
    return 0;
  }
  const backup = path.resolve(opt('--backup', path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'puerta-live-anterior')));
  fs.mkdirSync(backup, { recursive: true });
  for (const s of st) fs.writeFileSync(path.join(backup, s.file), s.live);
  say(`Copia del código LIVE actual en ${backup}`);
  for (const s of st) {
    if (s.devSame) continue;
    toDevelopment(s.name, s.local, work);
    say(`+ ${s.name}: ${s.file} subido a DEVELOPMENT`);
  }
  runTests();
  for (const s of changed) {
    publishLive(s.name);
    say(`+ ${s.name}: publicado en LIVE`);
  }
  for (const s of st) {
    if (sha256(stageCode(s.name, 'LIVE', work)) !== sha256(s.local)) fatal(`${s.name}: tras publicar, LIVE no es ${s.file}`);
  }
  say('= Puerta publicada y comprobada: LIVE = código de esta carpeta.');
  return 0;
}

function phaseRollback(work) {
  const from = opt('--from');
  if (!from) fatal('rollback necesita --from <carpeta guardada por publish>');
  if (!fs.existsSync(from)) {
    say(`= No hay copia en ${from}: en esta ejecución la puerta no cambió; nada que deshacer.`);
    return 0;
  }
  for (const f of FUNCTIONS) {
    const code = fs.readFileSync(path.join(from, f.file));
    if (sha256(stageCode(f.name, 'LIVE', work)) === sha256(code)) {
      say(`= ${f.name}: LIVE ya es la copia guardada`);
      continue;
    }
    toDevelopment(f.name, code, work);
    publishLive(f.name);
    say(`+ ${f.name}: LIVE vuelve a la copia guardada`);
  }
  return 0;
}

const PHASES = { plan: phasePlan, publish: phasePublish, rollback: phaseRollback };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
try {
  if (!PHASES[cmd]) {
    console.error('Uso: node ci_gate.mjs plan | publish [--backup carpeta] | rollback --from carpeta');
    process.exitCode = 64;
  } else {
    checkAccount();
    process.exitCode = PHASES[cmd](work);
  }
} catch (error) {
  console.error('ERROR: ' + (error instanceof Fatal ? error.message : (error && error.stack) || error));
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
