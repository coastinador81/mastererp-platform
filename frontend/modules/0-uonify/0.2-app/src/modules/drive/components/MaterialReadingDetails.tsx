import type { MaterialEvidence, MaterialSource } from '../api/productMaterials';
import { InformationDisclosure } from '@/shared/ui';
import { customerLocation } from '@/shared/lib/customerText';

const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function remedy(source: MaterialSource) {
  if (source.remedy) return source.remedy;
  const reason = `${source.reason ?? ''} ${source.message ?? ''}`.toLowerCase();
  if (/cifra|contraseña|password|encrypted/.test(reason)) return 'Aporta una copia sin contraseña o exporta las páginas a PDF o imágenes. Conservaremos el archivo original.';
  if (/zip|comprimid|archivo anidado|archive/.test(reason)) return 'Extrae los documentos necesarios en una subcarpeta de Drive y analiza esa carpeta desde aquí.';
  if (/blend|blender/.test(reason) || /\.blend$/i.test(source.name)) return 'Aporta una copia de Blender con sus recursos empaquetados o exporta las vistas y medidas de diseño a PDF. Las medidas seguirán siendo nominales.';
  if (/svg|vector/.test(reason) || /\.svg$/i.test(source.name)) return 'Aporta un SVG sin scripts ni enlaces externos, o exporta el dibujo a PDF o PNG con buena resolución.';
  if (/imagen|ilegible|ocr|image/.test(reason)) return 'Aporta una imagen enfocada del original, con el texto completo y sin recortes, o el documento de origen.';
  return 'Aporta una versión en PDF, imágenes legibles o una hoja sin macros y vuelve a analizarla desde esta conversación.';
}

export function MaterialReadingDetails({ source }: { source: MaterialSource }) {
  const coverage = source.readingCoverage;
  const barcodeCount = Array.isArray(coverage?.barcodes) ? coverage.barcodes.length : coverage?.barcodes;
  const archiveCount = Array.isArray(coverage?.archiveEntries) ? coverage.archiveEntries.length : coverage?.archiveEntries;
  const hasVisualReading = !!coverage && (coverage.hybrid === true || coverage.ocr === true || (typeof coverage.ocr === 'object' && coverage.ocr.units > 0) || (coverage.ocrRegions ?? 0) > 0 || !!coverage.visualUnits?.some(item => item.status === 'read'));
  const readTables = coverage?.tables?.filter(table => table.status === 'read').length ?? 0;
  const pendingTables = coverage?.tables?.filter(table => table.status !== 'read').length ?? 0;
  const failed = ['unsupported', 'skipped', 'error'].includes(source.status);
  if (!coverage && !failed) return null;
  return <div className="drive-reading-details">
    {coverage && <>
      {coverage.complete === false && <p className="drive-analysis-warnings">Lectura parcial: algunas partes requieren otra fuente o una revisión.</p>}
      {hasVisualReading && <InformationDisclosure label="Sobre la lectura de imágenes"><p>Uony compara el texto y las imágenes con los documentos para completar los datos del producto.</p></InformationDisclosure>}
      {typeof coverage.ocr === 'object' && coverage.ocr.lowConfidenceLines > 0 && <small className="drive-analysis-warnings">{coverage.ocr.lowConfidenceLines} líneas reconocidas con baja confianza. Comprueba el texto contra el original antes de confirmar sus datos.</small>}
      {(count(coverage.pages) || count(coverage.regions) || count(coverage.ocrRegions)) && <small>{[count(coverage.pages) ? `${coverage.pages} páginas` : '', count(coverage.regions) ? `${coverage.regions} regiones` : '', count(coverage.ocrRegions) ? `${coverage.ocrRegions} regiones con reconocimiento de texto` : ''].filter(Boolean).join(' · ')}</small>}
      {count(barcodeCount) && (barcodeCount > 0 || hasVisualReading) && <><small>{barcodeCount} {barcodeCount === 1 ? 'código de barras leído' : 'códigos de barras leídos'}.</small><InformationDisclosure label="Sobre los códigos de barras"><p>Leer un código no verifica a quién pertenece ni la seguridad del producto.</p></InformationDisclosure></>}
      {!!coverage.visualUnits?.length && <small>{coverage.visualUnits.length} vistas o páginas localizadas · {coverage.visualUnits.reduce((sum, item) => sum + (item.detailRegions ?? 0), 0)} ampliaciones desde el original.</small>}
      {!!readTables && <small>{readTables} {readTables === 1 ? 'tabla con sus filas y ubicación conservadas' : 'tablas con sus filas y ubicación conservadas'}.</small>}
      {!!pendingTables && <small className="drive-analysis-warnings">{pendingTables} {pendingTables === 1 ? 'tabla sin filas estructuradas' : 'tablas sin filas estructuradas'}. Revisa sus datos en la imagen; localizarla no equivale a haber extraído su contenido tabular.</small>}
      {Array.isArray(coverage.barcodes) && coverage.barcodes.length > 0 && <details><summary>Códigos encontrados</summary><ul>{coverage.barcodes.map((code, index) => <li key={index}>{code.format}: {code.value} · {code.structureValid === true ? 'estructura válida' : code.structureValid === false ? 'estructura no válida' : 'sin verificación GTIN'}</li>)}</ul></details>}
      {coverage.native && <>
        <small>Lectura del archivo 3D: {count(coverage.scenes) ? `${coverage.scenes} escenas · ` : ''}{count(coverage.objects) ? `${coverage.objects} objetos · ` : ''}{count(coverage.materials) ? `${coverage.materials} materiales` : ''}</small>
        {coverage.nominalGeometry && <InformationDisclosure label="Sobre las medidas del diseño"><p>Las dimensiones proceden del diseño 3D; no son medidas de una muestra física.</p></InformationDisclosure>}
        {!!coverage.externalTextures && <small className="drive-analysis-warnings">{coverage.externalTextures} texturas externas sin cargar. Empaquétalas en Blender para completar su lectura.</small>}
        {!!coverage.externalLibraries && <small className="drive-analysis-warnings">{coverage.externalLibraries} bibliotecas externas sin cargar. Incluye los recursos en el archivo de origen.</small>}
        {!!source.excerpts?.length && <details><summary>Extracto del archivo 3D</summary><p>Primeros registros del diseño. Las medidas son nominales y los datos completos se conservan en el análisis.</p><ul>{source.excerpts.map((item, index) => <li key={index}><strong>{item.locator}</strong><q>{item.text}</q></li>)}</ul></details>}
        {coverage.visualPreviewGenerated === false && <small>Esta inspección describe la escena guardada; no se ha generado una nueva vista renderizada.</small>}
      </>}
      {!!coverage.formulaCells && <small>{coverage.formulaCells} celdas con fórmula. Se conserva la expresión y el valor guardado; no se ejecutan macros ni se recalcula el libro.</small>}
      {!!coverage.missingFormulaValues && <small className="drive-analysis-warnings">{coverage.missingFormulaValues} fórmulas sin valor guardado. Recalcula y guarda una copia en tu hoja de cálculo, o aporta los valores.</small>}
      {!!coverage.invalidFormulaValues && <small className="drive-analysis-warnings">{coverage.invalidFormulaValues} fórmulas guardadas con error. Corrige y recalcula esos campos en el archivo de origen.</small>}
      {!!coverage.uncertainFormulaValues && <small className="drive-analysis-warnings">{coverage.uncertainFormulaValues} resultados guardados cuya vigencia debe comprobarse.</small>}
      {count(archiveCount) && <small>{archiveCount} elementos del archivo comprimido{count(coverage.entriesRead) ? ` · ${coverage.entriesRead} leídos` : ''}{count(coverage.entriesPending ?? coverage.entriesUnsupported) ? ` · ${coverage.entriesPending ?? coverage.entriesUnsupported} con formato pendiente` : ''}.</small>}
    </>}
    {Array.isArray(coverage?.archiveEntries) && coverage.archiveEntries.some(entry => entry.reason) && <details><summary>Elementos del comprimido por completar</summary><ul>{coverage.archiveEntries.filter(entry => entry.reason).map((entry, index) => <li key={index}>{entry.path}: {entry.reason}</li>)}</ul><p>Extrae estos elementos en una carpeta y aporta una versión compatible desde este mismo chat.</p></details>}
    {failed && <p><strong>Cómo continuar:</strong> {remedy(source)} Puedes aportar la nueva versión y continuar el análisis en este mismo chat.</p>}
  </div>;
}

export function MaterialEvidenceLocation({ evidence }: { evidence: MaterialEvidence }) {
  const region = evidence.region;
  const structureValid = evidence.structureValid ?? evidence.barcode?.structureValid;
  const methods: Record<string, string> = { ocr: 'Texto reconocido en la imagen', barcode: 'Código de barras decodificado', native: 'Datos del archivo nativo', pdf_text: 'Texto del documento', pdf_table: 'Tabla del documento', chart_cache: 'Valores guardados del gráfico, sin recalcular' };
  return <>
    {evidence.method && <span>{methods[evidence.method] ?? 'Lectura del original'}{evidence.confidence !== undefined ? ` · confianza del reconocimiento: ${Math.round(evidence.confidence)} %` : ''}</span>}
    {region?.page && <span>Página {region.page} del documento original.</span>}
    {!!evidence.formulaEvidence?.length && <details><summary>Fórmula y valor guardado</summary><ul>{evidence.formulaEvidence.map((formula, index) => <li key={index}>
      <span>{customerLocation(formula.locator)} · {formula.formula}</span>
      <span>{formula.cacheStatus === 'missing' ? 'Sin resultado guardado en el archivo.' : formula.cacheStatus === 'cached_error' ? `Resultado guardado con error: ${String(formula.cachedValue)}.` : `Valor guardado: ${String(formula.cachedValue)}. Su vigencia no está comprobada.`} La fórmula no se ha ejecutado.</span>
    </li>)}</ul></details>}
    {evidence.method === 'barcode' && <><span>{structureValid === true ? 'Formato del código válido.' : structureValid === false ? 'El formato del código requiere corrección.' : 'Formato del código sin verificar.'}</span><InformationDisclosure label="Sobre esta comprobación"><p>Esta comprobación no verifica a quién pertenece el código.</p></InformationDisclosure></>}
  </>;
}
