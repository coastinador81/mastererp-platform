// Identificadores internos en el build de la web (paso 2 de la arquitectura del dueño, 20-11-2026).
// Recorre los ficheros de texto de dist/ y falla si aparece un identificador interno exacto que no
// tenga una excepción vigente en internal-ids-allowlist.json:
//   - modelo: un id crudo del catálogo (ModelId de backend/…/creative_google_capabilities.py),
//     la misma fuente única que usa el guard de salida del backend (creative_estudio_agent_tools.py);
//   - sha256: 64 caracteres hexadecimales seguidos;
//   - gcs: una ruta gs://;
//   - campo: planSha256, googleCloudProjectId o un importe en dólares (…Usd, …_usd).
// Una excepción tiene valor exacto, motivo y fecha «hasta»: caducada, falla; sin uso, avisa.
// Uso: node scripts/check-internal-ids.mjs --dist dist --catalogo <fichero.py> [--hoy AAAA-MM-DD]
//      node scripts/check-internal-ids.mjs --probar --catalogo <fichero.py>   (casos trampa)
// Sale con 0 si todo está bien, con 1 si hay hallazgos y con 2 si falta algo.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const TEXTO = /\.(?:html|js|mjs|css|json|txt|xml|svg|webmanifest|map)$/i;
const EXCEPCIONES = new URL('./internal-ids-allowlist.json', import.meta.url).pathname;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRONES = [
  ['sha256', /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g],
  ['gcs', /gs:\/\//g],
  ['campo', /\b(?:planSha256|googleCloudProjectId|[a-z][A-Za-z0-9]*Usd|[a-z][a-z0-9]*(?:_[a-z0-9]+)*_usd)\b/g],
];

function argumentos(lista) {
  const salida = {};
  for (let i = 0; i < lista.length; i += 1) {
    if (lista[i] === '--probar') salida.probar = true;
    else if (lista[i].startsWith('--') && i + 1 < lista.length) salida[lista[i].slice(2)] = lista[(i += 1)];
    else throw new Error(`argumento desconocido o sin valor: ${lista[i]}`);
  }
  return salida;
}

/** Los valores de `class ModelId(str, Enum)`: las líneas NOMBRE = "valor" hasta el siguiente bloque. */
export function modelos(python) {
  const inicio = python.search(/^class ModelId\(/m);
  if (inicio < 0) throw new Error('el catálogo no tiene class ModelId');
  const cuerpo = python.slice(inicio).split('\n').slice(1);
  const fin = cuerpo.findIndex(linea => /^\S/.test(linea));
  const bloque = (fin < 0 ? cuerpo : cuerpo.slice(0, fin)).join('\n');
  const ids = [...bloque.matchAll(/^\s+[A-Z0-9_]+\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
  if (ids.length === 0) throw new Error('ModelId no tiene ningún id');
  return ids;
}

function ficheros(dir) {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return TEXTO.test(nombre) ? [ruta] : [];
  });
}

/** [{tipo, valor, fichero, veces}] de todo dist: una entrada por valor distinto y fichero. */
export function hallazgos(dist, ids) {
  const salida = [];
  for (const ruta of ficheros(dist)) {
    const texto = readFileSync(ruta, 'utf8');
    const cuenta = new Map();
    for (const id of ids) {
      const veces = texto.split(id).length - 1;
      if (veces) cuenta.set(`modelo\u0000${id}`, veces);
    }
    for (const [tipo, patron] of PATRONES) {
      for (const m of texto.matchAll(patron)) {
        const clave = `${tipo}\u0000${m[0]}`;
        cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
      }
    }
    for (const [clave, veces] of cuenta) {
      const [tipo, valor] = clave.split('\u0000');
      salida.push({ tipo, valor, fichero: relative(dist, ruta), veces });
    }
  }
  return salida;
}

/** Errores y avisos de unos hallazgos frente a la lista de excepciones, a fecha `hoy`. */
export function juzgar(lista, excepciones, hoy) {
  const errores = [];
  const avisos = [];
  const vigentes = new Map();
  for (const e of excepciones) {
    if (!e || typeof e.valor !== 'string' || !e.motivo || !FECHA.test(e.hasta ?? '')) {
      errores.push(`excepción mal escrita: ${JSON.stringify(e)}`);
    } else if (e.hasta < hoy) {
      errores.push(`excepción caducada el ${e.hasta}: «${e.valor}» (${e.motivo})`);
    } else {
      vigentes.set(e.valor, e);
    }
  }
  const usadas = new Set();
  const cubiertos = [];
  for (const h of lista) {
    const donde = `${h.tipo}: «${h.valor}» en ${h.fichero} (${h.veces} ${h.veces === 1 ? 'vez' : 'veces'})`;
    if (vigentes.has(h.valor)) {
      usadas.add(h.valor);
      cubiertos.push(`${donde}, con excepción hasta el ${vigentes.get(h.valor).hasta}`);
    } else {
      errores.push(donde);
    }
  }
  for (const valor of vigentes.keys()) {
    if (!usadas.has(valor)) avisos.push(`excepción sin uso, quitarla: «${valor}»`);
  }
  return { errores, avisos, cubiertos };
}

/** Casos trampa: lo que se tiene que cazar se caza, y lo limpio pasa. */
function probar(ids) {
  const casos = [
    ['modelo', `fetch("/x",{body:JSON.stringify({model:"${ids[0]}"})})`, 1],
    ['sha256', `const h="${'ab'.repeat(32)}";`, 1],
    ['gcs', 'const u="gs://bucket/objeto";', 1],
    ['campo', 'a.planSha256;b.googleCloudProjectId;c.spendLimitUsd;d.max_cost_usd', 4],
    ['limpio', 'const p={maxEur:"1,20 €",currency:"EUR",motor:"Veo 3.1 Fast"};', 0],
    ['hex-largo', `const h="${'a'.repeat(65)}";`, 0],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ids-trampa-'));
  let malos = 0;
  const comprobar = (nombre, bien, detalle) => {
    if (!bien) malos += 1;
    console.log(`${bien ? 'ok   ' : 'FALLO'} ${nombre}: ${detalle}`);
  };
  try {
    for (const [nombre, contenido] of casos) writeFileSync(join(dir, `${nombre}.js`), contenido);
    const lista = hallazgos(dir, ids);
    for (const [nombre, , esperados] of casos) {
      const n = lista.filter(h => h.fichero === `${nombre}.js`).length;
      comprobar(nombre, n === esperados, `${n} hallazgos (se esperan ${esperados})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const hoy = '2026-11-21';
  const plan = [{ tipo: 'campo', valor: 'planSha256', fichero: 'a.js', veces: 1 }];
  const caducada = juzgar(plan, [{ valor: 'planSha256', motivo: 'prueba', hasta: '2026-11-20' }], hoy);
  comprobar('caducada', caducada.errores.length === 2, 'falla la excepción y el hallazgo que ya no tapa');
  const vigente = juzgar(plan, [{ valor: 'planSha256', motivo: 'prueba', hasta: hoy }], hoy);
  comprobar('vigente', vigente.errores.length === 0 && vigente.avisos.length === 0, 'tapa el hallazgo');
  const sinUso = juzgar([], [{ valor: 'otro', motivo: 'prueba', hasta: hoy }], hoy);
  comprobar('sin-uso', sinUso.errores.length === 0 && sinUso.avisos.length === 1, 'solo avisa');
  console.log(`Casos trampa de identificadores internos: ${casos.length + 3 - malos} de ${casos.length + 3} bien`);
  return malos === 0 ? 0 : 1;
}

function main() {
  try {
    const opciones = argumentos(process.argv.slice(2));
    if (!opciones.catalogo || (!opciones.probar && !opciones.dist)) {
      throw new Error('faltan --catalogo y --dist (o --probar)');
    }
    const ids = modelos(readFileSync(opciones.catalogo, 'utf8'));
    if (opciones.probar) return probar(ids);
    const hoy = opciones.hoy ?? new Date().toISOString().slice(0, 10);
    const excepciones = JSON.parse(readFileSync(EXCEPCIONES, 'utf8'));
    const lista = hallazgos(opciones.dist, ids);
    const { errores, avisos, cubiertos } = juzgar(lista, excepciones, hoy);
    for (const cubierto of cubiertos) console.log(`::notice::${cubierto}`);
    for (const aviso of avisos) console.log(`::warning::${aviso}`);
    for (const error of errores) console.log(`::error::${error}`);
    console.log(`Identificadores internos en ${opciones.dist}: ${lista.length} hallazgos, `
      + `${errores.length} errores (${ids.length} ids del catálogo, ${excepciones.length} excepciones).`);
    return errores.length ? 1 : 0;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }
}

process.exitCode = main();
