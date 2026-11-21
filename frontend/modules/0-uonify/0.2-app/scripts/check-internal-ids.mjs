// Identificadores internos en el build de la web (paso 2 de la arquitectura del dueño, 20-11-2026).
// Recorre los ficheros de texto de dist/ y falla si aparece un identificador interno exacto que no
// tenga una excepción vigente en internal-ids-allowlist.json:
//   - modelo: un id crudo del catálogo (ModelId de backend/…/creative_google_capabilities.py), la
//     misma fuente única que usa el guard de salida del backend (creative_estudio_agent_tools.py);
//   - sha256: 64 caracteres hexadecimales seguidos;
//   - almacen: una ruta gs:// o s3://, o un host de Cloud Storage o de S3;
//   - cuenta: el número de la cuenta de AWS de DEV; proyecto: un id de proyecto uonify-<hex>;
//   - campo: planSha256, googleCloudProjectId, assistantNotes o un importe en dólares (…Usd, …USD, …_usd).
// Además falla si el dist publica mapas de código fuente (.map), sin excepción posible.
// Una excepción tiene valor exacto, motivo y fecha «hasta»: caducada, falla; sin uso, avisa.
// Es una red contra descuidos, no un cortafuegos: no ve lo que la API manda en ejecución, ni un id
// partido, codificado o compuesto; eso lo arreglan el servidor (C3) y la revisión del código.
// Uso: node scripts/check-internal-ids.mjs --dist dist --catalogo <fichero.py> [--hoy AAAA-MM-DD]
//      node scripts/check-internal-ids.mjs --probar --catalogo <fichero.py>   (casos trampa)
// Sale con 0 si todo está bien, con 1 si hay hallazgos y con 2 si falta algo.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const TEXTO = /\.(?:html|js|mjs|css|json|txt|xml|svg|webmanifest|map)$/i;
const MAPA = /\.map$/i;
const EXCEPCIONES = new URL('./internal-ids-allowlist.json', import.meta.url).pathname;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CUENTA_AWS = '277352717693';
const PATRONES = [
  ['sha256', /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g],
  ['almacen', /gs:\/\/|s3:\/\/|\bstorage\.(?:googleapis|cloud\.google)\.com\b|\bs3[.-](?:[a-z0-9-]+\.)?amazonaws\.com\b/g],
  ['cuenta', new RegExp(`(?<!\\d)${CUENTA_AWS}(?!\\d)`, 'g')],
  ['proyecto', /\buonify-[0-9a-f]{20,}\b/g],
  ['campo', /\b(?:planSha256|googleCloudProjectId|assistantNotes|[a-z][A-Za-z0-9]*(?:Usd|USD)|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*_(?:usd|USD))\b/g],
];
const escapar = texto => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function argumentos(lista) {
  const salida = {};
  for (let i = 0; i < lista.length; i += 1) {
    if (lista[i] === '--probar') salida.probar = true;
    else if (lista[i].startsWith('--') && i + 1 < lista.length) salida[lista[i].slice(2)] = lista[(i += 1)];
    else throw new Error(`argumento desconocido o sin valor: ${lista[i]}`);
  }
  return salida;
}

/** Los valores de `class ModelId(str, Enum)`: las líneas NOMBRE = "valor" (o 'valor') hasta el
 * siguiente bloque. Falla si algún miembro no es un literal (auto(), f-string, concatenación…), para
 * que el catálogo no se lea de menos sin que nadie se entere. */
export function modelos(python) {
  const inicio = python.search(/^class ModelId\(/m);
  if (inicio < 0) throw new Error('el catálogo no tiene class ModelId');
  const cuerpo = python.slice(inicio).split('\n').slice(1);
  const fin = cuerpo.findIndex(linea => /^\S/.test(linea));
  const bloque = (fin < 0 ? cuerpo : cuerpo.slice(0, fin)).join('\n');
  const miembros = [...bloque.matchAll(/^\s+[A-Z][A-Z0-9_]*\s*=/gm)].length;
  const ids = [...bloque.matchAll(/^\s+[A-Z][A-Z0-9_]*\s*=\s*(["'])([^"'\n]+)\1\s*(?:#.*)?$/gm)].map(m => m[2]);
  if (ids.length === 0) throw new Error('ModelId no tiene ningún id');
  if (ids.length !== miembros) {
    throw new Error(`ModelId tiene ${miembros} miembros y solo ${ids.length} se leen como literal: revisar el catálogo o este lector`);
  }
  return ids;
}

function ficheros(dir) {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return TEXTO.test(nombre) ? [ruta] : [];
  });
}

/** Los mapas de código fuente del dist: con uno, se recupera el código entero. */
export function mapasDe(dist) {
  return ficheros(dist).filter(ruta => MAPA.test(ruta)).map(ruta => relative(dist, ruta));
}

/** [{tipo, valor, fichero, veces}] de todo dist: una entrada por valor distinto y fichero. */
export function hallazgos(dist, ids) {
  // Frontera: un id del catálogo dentro de otro más largo («…-preview») no es ese id.
  const modelosConBorde = ids.map(id => [id, new RegExp(`(?<![A-Za-z0-9._-])${escapar(id)}(?![A-Za-z0-9._-])`, 'g')]);
  const salida = [];
  for (const ruta of ficheros(dist)) {
    const texto = readFileSync(ruta, 'utf8');
    const cuenta = new Map();
    for (const [id, patron] of modelosConBorde) {
      const veces = [...texto.matchAll(patron)].length;
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

/** Errores, avisos y hallazgos tapados frente a la lista de excepciones, a fecha `hoy`. */
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
    ['modelo-borde', `const m="${ids[0]}-preview";`, 0],
    ['sha256', `const h="${'ab'.repeat(32)}";`, 1],
    ['almacen', 'a="gs://b/o";b="https://storage.googleapis.com/b/o";c="s3://b/k";d="https://b.s3.eu-west-1.amazonaws.com/k";', 4],
    ['cuenta', `const b="uonify-dev-web-${CUENTA_AWS}";`, 1],
    ['proyecto', 'const p="uonify-0123456789abcdef0123";', 1],
    ['campo', 'a.planSha256;b.googleCloudProjectId;c.spendLimitUsd;d.max_cost_usd;e.costUSD;f.COST_USD;g.assistantNotes', 7],
    ['limpio', 'const p={maxEur:"1,20 €",currency:"USD",motor:"Veo 3.1 Fast",total:12345678901};', 0],
    ['hex-largo', `const h="${'a'.repeat(65)}";`, 0],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ids-trampa-'));
  let malos = 0;
  let total = 0;
  const comprobar = (nombre, bien, detalle) => {
    total += 1;
    if (!bien) malos += 1;
    console.log(`${bien ? 'ok   ' : 'FALLO'} ${nombre}: ${detalle}`);
  };
  try {
    for (const [nombre, contenido] of casos) writeFileSync(join(dir, `${nombre}.js`), contenido);
    writeFileSync(join(dir, 'limpio.js.map'), '{}');
    const lista = hallazgos(dir, ids);
    for (const [nombre, , esperados] of casos) {
      const n = lista.filter(h => h.fichero === `${nombre}.js`).length;
      comprobar(nombre, n === esperados, `${n} hallazgos (se esperan ${esperados})`);
    }
    const mapas = mapasDe(dir);
    comprobar('mapa', mapas.length === 1, `${mapas.length} mapas de código fuente (se espera 1)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const catalogo = cuerpo => `class ModelId(str, Enum):\n    """Doc."""\n${cuerpo}\n\ndef otra():\n    X = 1\n`;
  comprobar('lector-comillas', modelos(catalogo('    A = "a-1"\n    B = \'b-2\'')).join() === 'a-1,b-2', 'lee comillas dobles y simples');
  let lectorFalla = false;
  try { modelos(catalogo('    A = "a-1"\n    B = auto()')); } catch { lectorFalla = true; }
  comprobar('lector-de-menos', lectorFalla, 'falla si un miembro no es un literal');
  const hoy = '2026-11-21';
  const plan = [{ tipo: 'campo', valor: 'planSha256', fichero: 'a.js', veces: 1 }];
  const caducada = juzgar(plan, [{ valor: 'planSha256', motivo: 'prueba', hasta: '2026-11-20' }], hoy);
  comprobar('caducada', caducada.errores.length === 2, 'falla la excepción y el hallazgo que ya no tapa');
  const vigente = juzgar(plan, [{ valor: 'planSha256', motivo: 'prueba', hasta: hoy }], hoy);
  comprobar('vigente', vigente.errores.length === 0 && vigente.avisos.length === 0, 'tapa el hallazgo');
  const sinUso = juzgar([], [{ valor: 'otro', motivo: 'prueba', hasta: hoy }], hoy);
  comprobar('sin-uso', sinUso.errores.length === 0 && sinUso.avisos.length === 1, 'solo avisa');
  console.log(`Casos trampa de identificadores internos: ${total - malos} de ${total} bien`);
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
    const mapas = mapasDe(opciones.dist);
    if (mapas.length) errores.push(`mapa: el dist publica ${mapas.length} mapas de código fuente (${mapas.slice(0, 5).join(', ')}…); no van en el público`);
    for (const cubierto of cubiertos) console.log(`::notice::${cubierto}`);
    for (const aviso of avisos) console.log(`::warning::${aviso}`);
    for (const error of errores) console.log(`::error::${error}`);
    console.log(`Identificadores internos en ${opciones.dist}: ${lista.length} hallazgos, `
      + `${errores.length} errores (${ids.length} ids del catálogo, ${excepciones.length} excepciones, ${mapas.length} mapas).`);
    return errores.length ? 1 : 0;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }
}

process.exitCode = main();
