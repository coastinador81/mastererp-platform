import {
  DEMO_MODULES,
  NEXUS_INTEGRATIONS,
  PLATFORMS,
  searchServices,
  nexusCapabilityId,
  DEMO_NEXUS_KNOWLEDGE_SOURCES,
  DEMO_KNOWLEDGE_BASES,
  DEMO_PREDEFINED_AGENTS,
  DEMO_RAG_QUESTIONS,
  DEMO_SYNTHETIC_FRAGMENTS,
  DEMO_TEMPLATES,
  createSessionBase,
  defaultDraft,
  knowledgeSummary,
  loadDraft,
  saveDraft,
  simulateRag,
  simulateResponse,
  statusLabel,
} from './agent-builder-demo.mjs';

const STEPS = [
  { id: 1, title: 'Tipo de agente' },
  { id: 2, title: 'Identidad y objetivo' },
  { id: 3, title: 'Conocimiento' },
  { id: 4, title: 'Herramientas y conexiones' },
  { id: 5, title: 'Límites y aprobaciones' },
  { id: 6, title: 'Prueba y resumen' },
];

const APPROVAL_OPTIONS = [
  { id: 'send-message', label: 'Enviar mensajes a clientes' },
  { id: 'change-invoice', label: 'Modificar importes o vencimientos' },
  { id: 'create-order', label: 'Crear pedidos o documentos' },
  { id: 'external-call', label: 'Llamar a sistemas externos' },
];

let draft = defaultDraft();
let skipDiscardCheck = false;

const els = {
  steps: document.getElementById('builder-steps'),
  panel: document.getElementById('builder-panel'),
  preview: document.getElementById('builder-preview'),
  previewBody: document.getElementById('preview-body'),
  progress: document.getElementById('builder-progress'),
  back: document.getElementById('btn-back'),
  next: document.getElementById('btn-next'),
  cancel: document.getElementById('btn-cancel'),
  toast: document.getElementById('draft-toast'),
};

function markDirty() {
  draft.dirty = true;
}

function renderSteps() {
  els.steps.innerHTML = `<h2>PASOS</h2><ol>${STEPS.map(
    (s) => `<li><button type="button" data-goto="${s.id}" ${draft.step === s.id ? 'aria-current="step"' : ''}><span class="step-num">${s.id}</span><span>${s.title}</span></button></li>`,
  ).join('')}</ol>`;
  els.steps.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.goto);
      if (target < draft.step || validateStep(draft.step, true)) {
        draft.step = target;
        render();
      }
    });
  });
}

function renderPreview() {
  const mode = draft.mode === 'orchestrator' ? 'Orquestador · personalizado' : 'Agente simple · personalizado';
  const caps = draft.capabilities.length;
  const kbase = knowledgeSummary(draft);
  const kbaseLabel = kbase.skipped
    ? 'Sin base de conocimiento'
    : `${kbase.baseRefs + kbase.sessionBases} base(s) · ${kbase.docCount} documento(s)`;
  els.previewBody.innerHTML = `
    <div class="preview-agent">
      <span class="preview-mark" aria-hidden="true">${draft.icon || 'A'}</span>
      <div>
        <strong style="font-size:16px;font-weight:500;color:var(--ink)">${draft.name || 'Sin nombre'}</strong>
        <p style="margin:4px 0 0;font-size:13px;color:var(--muted)">${draft.description || 'Añade una descripción breve.'}</p>
      </div>
    </div>
    <div class="preview-meta"><dl>
      <div><dt>Modo</dt><dd>${mode}</dd></div>
      <div><dt>Objetivo</dt><dd>${draft.objective || '—'}</dd></div>
      <div><dt>Conocimiento</dt><dd>${kbaseLabel}</dd></div>
      <div><dt>Fuentes Nexus pendientes</dt><dd>${kbase.externalPending}</dd></div>
      <div><dt>Herramientas</dt><dd>${caps} seleccionada${caps === 1 ? '' : 's'}</dd></div>
      ${draft.mode === 'orchestrator' ? `<div><dt>Agentes coordinados</dt><dd>${draft.childAgents.length || 'Ninguno aún'} · sin herencia de documentos</dd></div>` : ''}
    </dl></div>`;
}

function chipList(items, onRemove) {
  if (!items.length) return '<p class="field-error" style="color:var(--muted)">Ninguna selección todavía.</p>';
  return `<div class="chip-row" role="list">${items
    .map(
      (item) =>
        `<span class="chip" role="listitem">${item.label}<button type="button" aria-label="Quitar ${item.label}" data-remove="${item.id}">×</button></span>`,
    )
    .join('')}</div>`;
}

function renderNexusIntegrationSelect() {
  const services = searchServices(draft._capSearch || '');
  const groups = PLATFORMS.map((p) => {
    const items = services.filter((s) => s.platformId === p.id);
    if (!items.length) return '';
    return `<optgroup label="${esc(p.name)}">${items
      .map((s) => {
        const capId = nexusCapabilityId(s.id);
        const picked = draft.capabilities.includes(capId);
        return `<option value="${esc(capId)}" ${picked ? 'disabled' : ''}>${esc(s.name)}</option>`;
      })
      .join('')}</optgroup>`;
  }).join('');
  return groups || '<option value="">Sin coincidencias</option>';
}

function renderCapabilitiesPicker() {
  const q = (draft._capSearch || '').toLowerCase();
  const filter = (item) => !q || item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
  const mkCard = (item) => {
    const st = statusLabel(item.status);
    const on = draft.capabilities.includes(item.id);
    return `<button type="button" class="cap-card${on ? ' is-on' : ''}" data-cap="${item.id}" aria-pressed="${on}">
      <strong>${item.name}</strong><span>${item.desc}</span>
      <span class="status-pill ${st.class}">${st.text}</span>
    </button>`;
  };
  const selected = draft.capabilities
    .map((id) => {
      const found = [...DEMO_MODULES, ...NEXUS_INTEGRATIONS].find((x) => x.id === id);
      return found ? { id, label: found.name } : null;
    })
    .filter(Boolean);
  const agentsBlock =
    draft.mode === 'orchestrator'
      ? `<div class="cap-group"><h3>Otros agentes (orquestador)</h3><div class="cap-cards">${DEMO_PREDEFINED_AGENTS.map((a) => {
          const on = draft.childAgents.includes(a.id);
          return `<button type="button" class="cap-card${on ? ' is-on' : ''}" data-child="${a.id}" aria-pressed="${on}"><strong>${a.name}</strong><span>Módulo ${a.module}</span></button>`;
        }).join('')}</div></div>`
      : '';
  return `
    <h1>Herramientas y conexiones</h1>
    <p class="lead">Elige módulos internos e integraciones de Nexus que este agente podrá usar. Las credenciales se gestionan en Nexus.</p>
    <div class="field cap-search"><label for="cap-search">Buscar</label>
      <input id="cap-search" type="search" placeholder="Finanzas, WhatsApp, Teams…" value="${draft._capSearch || ''}" autocomplete="off"/>
    </div>
    <div><strong style="font-size:13px;color:var(--ink)">Seleccionadas</strong>${chipList(selected, true)}</div>
    <div class="cap-group"><h3>Módulos internos</h3><div class="cap-cards">${DEMO_MODULES.filter(filter).map(mkCard).join('')}</div></div>
    <div class="cap-group"><h3>Integraciones Nexus</h3>
      <p style="margin:0 0 10px;font-size:13px;color:var(--muted)">Mismo catálogo que en Nexus, agrupado por plataforma.</p>
      <div class="nexus-picker field">
        <label for="nexus-integration">Añadir integración</label>
        <div class="nexus-picker-row">
          <select id="nexus-integration" aria-describedby="nexus-picker-hint">
            <option value="">— Seleccionar servicio —</option>
            ${renderNexusIntegrationSelect()}
          </select>
          <button type="button" class="btn-secondary" id="nexus-integration-add">Añadir</button>
        </div>
        <p id="nexus-picker-hint" style="margin:8px 0 0;font-size:12px;color:var(--muted)">Use el buscador superior para filtrar opciones del desplegable.</p>
      </div>
    </div>
    ${agentsBlock}`;
}

function step1() {
  return `
    <h1>Tipo de agente</h1>
    <p class="lead">Elige el modo y si prefieres una plantilla de inicio o un lienzo vacío. Origen: <strong>personalizado</strong> (los predeterminados se configuran desde su ficha).</p>
    <div class="choice-grid" role="group" aria-label="Modo del agente">
      <button type="button" class="choice-card${draft.mode === 'simple' ? ' is-selected' : ''}" data-mode="simple">
        <span class="kicker">MODO</span>
        <h3>Agente simple</h3>
        <p>Realiza una función concreta: consultar, proponer o preparar una acción acotada.</p>
        <p style="margin-top:8px;font-size:12px;color:var(--muted)">Ejemplo: recordatorio de cobro amable.</p>
      </button>
      <button type="button" class="choice-card${draft.mode === 'orchestrator' ? ' is-selected' : ''}" data-mode="orchestrator">
        <span class="kicker">MODO</span>
        <h3>Orquestador</h3>
        <p>Coordina otros agentes y reúne resultados. No obtiene permisos extra por sí mismo.</p>
        <p style="margin-top:8px;font-size:12px;color:var(--muted)">Ejemplo: unificar Finanzas + Ecommerce.</p>
      </button>
    </div>
    <fieldset class="field" style="border:0;padding:0;margin-top:8px">
      <legend>Plantilla de inicio</legend>
      <div class="choice-grid">${Object.entries(DEMO_TEMPLATES)
        .map(
          ([key, t]) => `<button type="button" class="choice-card${draft.templateKey === key ? ' is-selected' : ''}" data-template="${key}">
        <h3>${t.label}</h3>
        <p>${t.mode === 'orchestrator' ? 'Orquestador' : 'Simple'} · plantilla precargada</p>
      </button>`,
        )
        .join('')}</div>
    </fieldset>`;
}

function step2() {
  return `
    <h1>Identidad y objetivo</h1>
    <p class="lead">Describe quién es el agente y qué debe lograr. Los datos se conservan al volver atrás en el asistente.</p>
    <div class="field${draft._errors?.name ? ' has-error' : ''}"><label for="f-name">Nombre del agente</label>
      <input id="f-name" type="text" required maxlength="80" value="${esc(draft.name)}" autocomplete="off"/>
      ${draft._errors?.name ? `<p class="field-error" id="err-name">${draft._errors.name}</p>` : ''}
    </div>
    <div class="field"><label for="f-icon">Icono (letra)</label>
      <input id="f-icon" type="text" maxlength="2" value="${esc(draft.icon)}" aria-describedby="icon-help"/>
      <p id="icon-help" style="margin:6px 0 0;font-size:12px;color:var(--muted)">Una letra visible en el catálogo local.</p>
    </div>
    <div class="field"><label for="f-desc">Descripción</label><textarea id="f-desc">${esc(draft.description)}</textarea></div>
    <div class="field field-highlight${draft._errors?.objective ? ' has-error' : ''}">
      <label for="f-objective">¿Qué quieres que haga este agente?</label>
      <textarea id="f-objective" required>${esc(draft.objective)}</textarea>
      ${draft._errors?.objective ? `<p class="field-error">${draft._errors.objective}</p>` : ''}
    </div>
    <div class="field"><label for="f-instructions">Instrucciones para el equipo</label><textarea id="f-instructions">${esc(draft.instructions)}</textarea></div>
    <details class="advanced"><summary>Opciones avanzadas</summary>
      <p style="margin:12px 0 0;font-size:13px;color:var(--muted)">Identificador interno se asignará al guardar. Sin integración API en esta entrega.</p>
    </details>`;
}

function formatDemoDate(ts) {
  return new Date(ts || Date.now()).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function renderDocRowsForSession(base) {
  if (!base.items.length) return '<tr><td colspan="5">Sin documentos en esta base.</td></tr>';
  return base.items
    .map((item) => {
      const canView = item.syntheticKey && DEMO_SYNTHETIC_FRAGMENTS[item.syntheticKey];
      return `<tr>
        <td>${esc(item.title || item.name)}</td>
        <td>${esc(item.kindLabel || item.kind)}</td>
        <td>${esc(item.status)}</td>
        <td>${formatDemoDate(item.addedAt)}</td>
        <td class="doc-actions">
          ${canView ? `<button type="button" data-view-doc="${item.syntheticKey}">Ver ejemplo</button>` : ''}
          <button type="button" data-remove-doc="${item.id}" data-base-id="${base.id}">Quitar</button>
        </td>
      </tr>`;
    })
    .join('');
}

function step3Knowledge() {
  const q = (draft._kbSearch || '').toLowerCase();
  const mode = draft.knowledgeSkipped ? 'skip' : draft._kbMode || 'existing';
  const activeBase =
    draft.sessionBases.find((b) => b.id === draft._activeSessionBaseId) || draft.sessionBases[0] || null;
  const selectedChips = draft.selectedBaseIds
    .map((id) => {
      const found = DEMO_KNOWLEDGE_BASES.find((b) => b.id === id) || draft.sessionBases.find((b) => b.id === id);
      return found ? `<span class="chip">${esc(found.name)}</span>` : '';
    })
    .join('');
  const catalogCards = DEMO_KNOWLEDGE_BASES.filter(
    (b) => !q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q),
  )
    .map((b) => {
      const on = draft.selectedBaseIds.includes(b.id);
      return `<button type="button" class="cap-card${on ? ' is-on' : ''}" data-kb="${b.id}" aria-pressed="${on}">
        <strong>${esc(b.name)}</strong>
        <span>${esc(b.description)}</span>
        <span class="status-pill demo">${b.docCount} docs · Centro de Documentación</span>
      </button>`;
    })
    .join('');
  const sessionForm = `
    <div class="field"><label for="kb-new-name">Nombre de la base</label>
      <input id="kb-new-name" type="text" maxlength="80" value="${esc(draft._kbNewName || '')}"/></div>
    <div class="field"><label for="kb-new-desc">Descripción</label>
      <textarea id="kb-new-desc">${esc(draft._kbNewDesc || '')}</textarea></div>
    <button type="button" class="btn-secondary" id="kb-create-base">Crear base de conocimiento</button>`;
  const enrichBlock = activeBase
    ? `
    <h2 style="font-size:16px;font-weight:500;color:var(--ink);margin:24px 0 8px">Contenidos de «${esc(activeBase.name)}»</h2>
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Los archivos seleccionados se registran como referencias hasta completar la indexación.</p>
    <input type="file" id="kb-file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden/>
    <div class="doc-actions">
      <button type="button" class="btn-secondary" id="kb-pick-file">Seleccionar archivo local (PDF/DOCX/TXT)</button>
      <button type="button" class="btn-secondary" id="kb-add-synth">Añadir documento de muestra</button>
    </div>
    <div class="field" style="margin-top:16px"><label for="kb-manual-title">Texto manual · título</label>
      <input id="kb-manual-title" type="text" value="${esc(draft._kbManualTitle || '')}"/></div>
    <div class="field"><label for="kb-manual-body">Texto manual · contenido</label>
      <textarea id="kb-manual-body">${esc(draft._kbManualBody || '')}</textarea>
      <button type="button" class="btn-secondary" id="kb-add-manual" style="margin-top:8px">Añadir texto a la base</button>
    </div>
    <div class="cap-group"><h3>Fuentes externas (Nexus)</h3>
      <div class="cap-cards">${DEMO_NEXUS_KNOWLEDGE_SOURCES.map((src) => {
        const on = draft.externalKnowledgeSources.includes(src.id);
        return `<button type="button" class="cap-card${on ? ' is-on' : ''}" data-ext-kb="${src.id}" aria-pressed="${on}">
          <strong>${esc(src.name)}</strong><span>${esc(src.desc)}</span>
          <span class="status-pill pending">Pendiente de conexión</span>
        </button>`;
      }).join('')}</div></div>
    <table class="doc-table" aria-label="Documentos de la base">
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th>Incorporado</th><th>Acciones</th></tr></thead>
      <tbody>${renderDocRowsForSession(activeBase)}</tbody>
    </table>
    <div id="kb-preview" class="cite-panel" hidden></div>`
    : '';
  const orchestratorNote =
    draft.mode === 'orchestrator'
      ? `<p class="orchestrator-kb-note" role="note"><strong>Orquestador:</strong> esta base es propia del agente. Los agentes participantes mantienen sus documentos; seleccionarlos más adelante no concede acceso automático a su conocimiento.</p>`
      : '';
  return `
    <h1>Conocimiento</h1>
    <p class="lead">Selecciona la información que este agente podrá consultar para responder con contexto y citar sus fuentes.</p>
    <fieldset class="field" style="border:0;padding:0">
      <legend>Modo</legend>
      <div class="kb-mode-row">
        <label><input type="radio" name="kb-mode" value="existing" ${mode === 'existing' ? 'checked' : ''}/> Usar bases existentes</label>
        <label><input type="radio" name="kb-mode" value="create" ${mode === 'create' ? 'checked' : ''}/> Crear base nueva</label>
        <label><input type="radio" name="kb-mode" value="skip" ${mode === 'skip' ? 'checked' : ''}/> Continuar sin base</label>
      </div>
    </fieldset>
    ${mode === 'skip' ? '<p class="status-pill pending" style="margin-top:0">Sin base de conocimiento · se mostrará en el resumen</p>' : ''}
    ${mode === 'existing' ? `
      <h2 style="font-size:16px;font-weight:500;color:var(--ink)">Bases del Centro de Documentación</h2>
      <p style="font-size:13px;color:var(--muted)">El agente solo guarda referencias autorizadas; no duplica los documentos.</p>
      <div class="field cap-search"><label for="kb-search">Buscar base</label>
        <input id="kb-search" type="search" placeholder="Ej. cobro, tono…" value="${esc(draft._kbSearch || '')}"/></div>
      <div class="cap-cards">${catalogCards}</div>
      <div style="margin-top:12px"><strong style="font-size:13px">Seleccionadas</strong><div class="chip-row">${selectedChips || '<span class="chip">Ninguna</span>'}</div></div>
    ` : ''}
    ${mode === 'create' ? `${orchestratorNote}${sessionForm}${enrichBlock}` : ''}`;
}

function step5() {
  const childNames = draft.childAgents.map((id) => DEMO_PREDEFINED_AGENTS.find((a) => a.id === id)?.name).filter(Boolean);
  const seq = childNames.length
    ? `<ol class="seq-list">${childNames.map((n, i) => `<li><span aria-hidden="true">${i + 1}</span> Consultar a <strong>${n}</strong> y combinar resultado</li>`).join('')}</ol>`
    : '<p style="color:var(--muted);font-size:13px">Selecciona agentes en el paso 4 para ver la secuencia.</p>';
  return `
    <h1>Límites y aprobaciones</h1>
    <p class="lead">Define qué puede hacer solo y qué debería pasar por una persona. Lenguaje cotidiano, sin motor de reglas complejo.</p>
    <fieldset class="field" style="border:0;padding:0">
      <legend>Nivel habitual del agente</legend>
      <label class="approval-row"><input type="checkbox" data-level="consult" ${draft.approvals.consult ? 'checked' : ''}/> Consultar información (solo lectura)</label>
      <label class="approval-row"><input type="checkbox" data-level="propose" ${draft.approvals.propose ? 'checked' : ''}/> Preparar propuestas (borradores)</label>
      <label class="approval-row"><input type="checkbox" data-level="execute" ${draft.approvals.execute ? 'checked' : ''}/> Ejecutar acciones (requiere aprobación)</label>
    </fieldset>
    <fieldset class="field" style="border:0;padding:0;margin-top:16px">
      <legend>Acciones que pedirían aprobación</legend>
      <div class="approval-list">${APPROVAL_OPTIONS.map(
        (o) => `<label class="approval-row"><input type="checkbox" data-approval="${o.id}" ${draft.approvalActions.includes(o.id) ? 'checked' : ''}/>${o.label}</label>`,
      ).join('')}</div>
    </fieldset>
    ${draft.mode === 'orchestrator' ? `<div style="margin-top:24px"><h2 style="font-size:16px;font-weight:500;color:var(--ink)">Coordinación (vista simple)</h2><p style="font-size:13px;color:var(--muted)">Secuencia lineal de pasos; no es un editor de nodos.</p>${seq}</div>` : ''}`;
}

function step6() {
  const caps = draft.capabilities
    .map((id) => [...DEMO_MODULES, ...NEXUS_INTEGRATIONS].find((c) => c.id === id)?.name)
    .filter(Boolean);
  const kbase = knowledgeSummary(draft);
  const knowText = kbase.skipped
    ? 'Sin base de conocimiento'
    : `${kbase.bases.map((b) => b.name).join(', ') || '—'} · ${kbase.docCount} documentos · ${kbase.externalPending} fuente(s) Nexus pendiente(s)`;
  const ragOptions = DEMO_RAG_QUESTIONS.map((q) => `<option value="${q.id}">${esc(q.label)}</option>`).join('');
  return `
    <h1>Prueba y resumen</h1>
    <p class="lead">Revisa la configuración, prueba respuestas con citas de tus fuentes y guarda un borrador en esta sesión.</p>
    <div class="summary-grid">
      ${summaryBlock(1, 'Tipo', draft.mode === 'orchestrator' ? 'Orquestador personalizado' : 'Agente simple personalizado')}
      ${summaryBlock(2, 'Identidad', `${draft.name || '—'} · ${draft.objective || 'Sin objetivo'}`)}
      ${summaryBlock(3, 'Conocimiento', knowText)}
      ${summaryBlock(4, 'Herramientas y conexiones', caps.join(', ') || 'Ninguna')}
      ${summaryBlock(5, 'Aprobaciones', `${draft.approvalActions.length} acción(es) marcadas`)}
    </div>
    <div class="chat-demo" aria-label="Prueba de respuestas con citas">
      <header>Prueba con conocimiento · citas de fuentes</header>
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <div class="chat-compose">
        <select id="scenario" aria-label="Pregunta sugerida">
          <optgroup label="Conocimiento">${ragOptions}</optgroup>
          <option value="cobro">Flujo: recordatorio de cobro</option>
          <option value="coord">Flujo: coordinar agentes</option>
          <option value="free">Mensaje libre</option>
        </select>
        <input id="free-text" type="text" placeholder="Escribe un mensaje de prueba" style="flex:2;padding:10px;border:1px solid #d8e2f0;border-radius:8px" hidden/>
        <button type="button" class="btn-secondary" id="run-sim">Probar</button>
      </div>
      <div id="cite-panel" class="cite-panel" hidden role="region" aria-label="Fragmento citado"></div>
    </div>
    <p style="margin-top:16px;font-size:12px;color:var(--muted)">Los borradores de esta sesión aparecen en el catálogo hasta que recargues la página.</p>
    <button type="button" class="btn-primary" id="save-draft" style="margin-top:12px">Guardar borrador</button>`;
}

function summaryBlock(step, title, value) {
  return `<article class="summary-block"><header><h3>${title}</h3><button type="button" data-goto-summary="${step}">Editar</button></header><p style="margin:0;font-size:13px;color:var(--text)">${esc(value)}</p></article>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function renderPanel() {
  const map = { 1: step1, 2: step2, 3: step3Knowledge, 4: renderCapabilitiesPicker, 5: step5, 6: step6 };
  els.panel.innerHTML = map[draft.step]();
  const title = els.panel.querySelector('h1');
  if (title) {
    title.setAttribute('tabindex', '-1');
    title.id = 'step-title';
  }
  els.progress.textContent = `Paso ${draft.step} de ${STEPS.length}`;
  els.back.disabled = draft.step === 1;
  els.next.textContent = draft.step === 6 ? 'Finalizar' : 'Continuar';
  bindPanel();
}

function activeSessionBase() {
  return draft.sessionBases.find((b) => b.id === draft._activeSessionBaseId) || draft.sessionBases[0] || null;
}

function showFragmentPanel(host, key) {
  if (!host) return;
  const frag = DEMO_SYNTHETIC_FRAGMENTS[key];
  if (!frag) return;
  host.hidden = false;
  host.innerHTML = `<h3>${esc(frag.title)} <span class="rag-flags">Fragmento citado</span></h3><p>${esc(frag.excerpt)}</p>`;
}

function bindPanel() {
  draft._errors = draft._errors || {};
  els.panel.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      draft.mode = btn.dataset.mode;
      if (draft.mode === 'simple') draft.childAgents = [];
      markDirty();
      render();
    }),
  );
  els.panel.querySelectorAll('[data-template]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const t = DEMO_TEMPLATES[btn.dataset.template];
      draft.templateKey = btn.dataset.template;
      if (btn.dataset.template !== 'blank') {
        Object.assign(draft, { mode: t.mode, name: t.name, icon: t.icon, description: t.description, objective: t.objective, instructions: t.instructions });
        if (t.mode === 'simple') draft.childAgents = [];
      }
      markDirty();
      render();
    }),
  );
  if (draft.step === 2) {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('input', () => {
        draft[key] = el.value;
        markDirty();
        renderPreview();
      });
    };
    bind('f-name', 'name');
    bind('f-icon', 'icon');
    bind('f-desc', 'description');
    bind('f-objective', 'objective');
    bind('f-instructions', 'instructions');
  }
  if (draft.step === 3) {
    els.panel.querySelectorAll('input[name="kb-mode"]').forEach((radio) =>
      radio.addEventListener('change', () => {
        draft._kbMode = radio.value;
        draft.knowledgeSkipped = radio.value === 'skip';
        markDirty();
        render();
      }),
    );
    const kbSearch = document.getElementById('kb-search');
    kbSearch?.addEventListener('input', () => {
      draft._kbSearch = kbSearch.value;
      renderPanel();
    });
    els.panel.querySelectorAll('[data-kb]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.kb;
        if (draft.selectedBaseIds.includes(id)) draft.selectedBaseIds = draft.selectedBaseIds.filter((x) => x !== id);
        else draft.selectedBaseIds.push(id);
        draft.knowledgeSkipped = false;
        markDirty();
        render();
      }),
    );
    const bindField = (id, key) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        draft[key] = e.target.value;
        markDirty();
      });
    };
    bindField('kb-new-name', '_kbNewName');
    bindField('kb-new-desc', '_kbNewDesc');
    bindField('kb-manual-title', '_kbManualTitle');
    bindField('kb-manual-body', '_kbManualBody');
    document.getElementById('kb-create-base')?.addEventListener('click', () => {
      const base = createSessionBase(draft._kbNewName || '', draft._kbNewDesc || '');
      draft.sessionBases.push(base);
      draft.selectedBaseIds.push(base.id);
      draft._activeSessionBaseId = base.id;
      draft.knowledgeSkipped = false;
      markDirty();
      render();
    });
    const fileInput = document.getElementById('kb-file');
    document.getElementById('kb-pick-file')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const base = activeSessionBase();
      const file = fileInput.files?.[0];
      if (!base || !file) return;
      const ext = (file.name.split('.').pop() || 'archivo').toUpperCase();
      base.items.push({
        id: `item-${Date.now()}`,
        name: file.name,
        title: file.name,
        kind: 'file',
        kindLabel: ext,
        status: 'Seleccionado · pendiente de indexar',
        addedAt: Date.now(),
      });
      fileInput.value = '';
      markDirty();
      render();
    });
    document.getElementById('kb-add-synth')?.addEventListener('click', () => {
      const base = activeSessionBase();
      if (!base) return;
      base.items.push({
        id: `item-${Date.now()}`,
        title: DEMO_SYNTHETIC_FRAGMENTS['doc-synth-plazo-pago'].title,
        kind: 'sample',
        kindLabel: 'Ejemplo',
        status: 'Fragmento sintético · listo para cita',
        syntheticKey: 'doc-synth-plazo-pago',
        addedAt: Date.now(),
      });
      markDirty();
      render();
    });
    document.getElementById('kb-add-manual')?.addEventListener('click', () => {
      const base = activeSessionBase();
      const title = (draft._kbManualTitle || '').trim();
      if (!base || !title) return;
      base.items.push({
        id: `item-${Date.now()}`,
        title,
        kind: 'manual',
        kindLabel: 'Texto manual',
        status: 'En memoria · pendiente de indexar',
        preview: (draft._kbManualBody || '').slice(0, 120),
        addedAt: Date.now(),
      });
      draft._kbManualTitle = '';
      draft._kbManualBody = '';
      markDirty();
      render();
    });
    els.panel.querySelectorAll('[data-ext-kb]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.extKb;
        if (draft.externalKnowledgeSources.includes(id)) {
          draft.externalKnowledgeSources = draft.externalKnowledgeSources.filter((x) => x !== id);
        } else draft.externalKnowledgeSources.push(id);
        markDirty();
        render();
      }),
    );
    els.panel.querySelectorAll('[data-remove-doc]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const base = draft.sessionBases.find((b) => b.id === btn.dataset.baseId);
        if (!base) return;
        base.items = base.items.filter((it) => it.id !== btn.dataset.removeDoc);
        markDirty();
        render();
      }),
    );
    els.panel.querySelectorAll('[data-view-doc]').forEach((btn) =>
      btn.addEventListener('click', () => showFragmentPanel(document.getElementById('kb-preview'), btn.dataset.viewDoc)),
    );
  }
  if (draft.step === 4) {
    const search = document.getElementById('cap-search');
    search?.addEventListener('input', () => {
      draft._capSearch = search.value;
      renderPanel();
      renderPreview();
    });
    els.panel.querySelectorAll('[data-cap]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.cap;
        if (draft.capabilities.includes(id)) draft.capabilities = draft.capabilities.filter((c) => c !== id);
        else draft.capabilities.push(id);
        markDirty();
        render();
      }),
    );
    els.panel.querySelectorAll('[data-child]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.child;
        if (draft.childAgents.includes(id)) draft.childAgents = draft.childAgents.filter((c) => c !== id);
        else draft.childAgents.push(id);
        markDirty();
        render();
      }),
    );
    els.panel.querySelectorAll('[data-remove]').forEach((btn) =>
      btn.addEventListener('click', () => {
        draft.capabilities = draft.capabilities.filter((c) => c !== btn.dataset.remove);
        markDirty();
        render();
      }),
    );
    document.getElementById('nexus-integration-add')?.addEventListener('click', () => {
      const select = document.getElementById('nexus-integration');
      const id = select?.value;
      if (!id || draft.capabilities.includes(id)) return;
      draft.capabilities.push(id);
      markDirty();
      render();
    });
    document.getElementById('nexus-integration')?.addEventListener('change', () => {
      const select = document.getElementById('nexus-integration');
      if (select?.value) document.getElementById('nexus-integration-add')?.focus();
    });
  }
  if (draft.step === 5) {
    els.panel.querySelectorAll('[data-level]').forEach((cb) =>
      cb.addEventListener('change', () => {
        draft.approvals[cb.dataset.level] = cb.checked;
        if (cb.dataset.level === 'execute' && cb.checked) {
          cb.checked = false;
          draft.approvals.execute = false;
          alert('Las acciones de ejecución requieren aprobación previa. Mantén esta opción desactivada si no está autorizada.');
        }
        markDirty();
        renderPreview();
      }),
    );
    els.panel.querySelectorAll('[data-approval]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const id = cb.dataset.approval;
        if (cb.checked) {
          if (!draft.approvalActions.includes(id)) draft.approvalActions.push(id);
        } else draft.approvalActions = draft.approvalActions.filter((x) => x !== id);
        markDirty();
        renderPreview();
      }),
    );
  }
  if (draft.step === 6) {
    els.panel.querySelectorAll('[data-goto-summary]').forEach((b) =>
      b.addEventListener('click', () => {
        draft.step = Number(b.dataset.gotoSummary);
        render();
      }),
    );
    const scenario = document.getElementById('scenario');
    const free = document.getElementById('free-text');
    scenario?.addEventListener('change', () => {
      free.hidden = scenario.value !== 'free';
    });
    document.getElementById('run-sim')?.addEventListener('click', runSimulation);
    document.getElementById('save-draft')?.addEventListener('click', () => {
      if (!validateStep(2, true)) {
        draft.step = 2;
        render();
        return;
      }
      const id = saveDraft(draft);
      draft.id = id;
      showToast('Borrador guardado en memoria. Visible en el catálogo hasta recargar.');
    });
  }
}

const RAG_SCENARIO_IDS = new Set(DEMO_RAG_QUESTIONS.map((q) => q.id));

function runSimulation() {
  const log = document.getElementById('chat-log');
  const citePanel = document.getElementById('cite-panel');
  const scenario = document.getElementById('scenario')?.value || 'rag-plazo';
  const freeText = document.getElementById('free-text')?.value || '';
  const ragQuestion = DEMO_RAG_QUESTIONS.find((q) => q.id === scenario);
  const userLabel = ragQuestion
    ? ragQuestion.label
    : scenario === 'free'
      ? freeText || 'Consulta general'
      : scenario === 'coord'
        ? '¿Cómo va el pedido 104 y su cobro?'
        : '¿Qué facturas están vencidas?';
  log.innerHTML += `<div class="bubble user">${esc(userLabel)}</div>`;
  if (RAG_SCENARIO_IDS.has(scenario)) {
    const rag = simulateRag(draft, scenario);
    let citeHtml = '';
    if (rag.cites.length) {
      citeHtml = `<span class="cite-links">${rag.cites
        .map(
          (c, i) => `<button type="button" data-cite-key="${c.id}">[${i + 1}] ${esc(c.title)}</button>`,
        )
        .join('')}</span>`;
    }
    log.innerHTML += `<div class="bubble agent">${esc(rag.text)}${citeHtml}<span class="sim-flag">${
      rag.disclaimer
    }</span></div>`;
    citePanel.hidden = true;
    log.querySelectorAll('[data-cite-key]').forEach((btn) =>
      btn.addEventListener('click', () => showFragmentPanel(citePanel, btn.dataset.citeKey)),
    );
  } else {
    const res = simulateResponse(draft, scenario, freeText);
    const tools = [...res.uses.modules, ...res.uses.nexus, ...res.uses.agents, ...res.uses.knowledgeBases];
    log.innerHTML += `<div class="bubble agent">${esc(res.text)}<span class="sim-flag">${res.disclaimer}${
      tools.length ? ` · Usaría (sin consultar): ${tools.join(', ')}` : ''
    }</span></div>`;
    citePanel.hidden = true;
  }
  log.scrollTop = log.scrollHeight;
}

function validateStep(step, silent = false) {
  draft._errors = {};
  if (step === 2) {
    if (!draft.name.trim()) draft._errors.name = 'Escribe un nombre para continuar.';
    if (!draft.objective.trim()) draft._errors.objective = 'Describe el objetivo principal del agente.';
    if (Object.keys(draft._errors).length) {
      if (!silent) renderPanel();
      return false;
    }
  }
  if (step === 4 && draft.mode === 'orchestrator' && draft.childAgents.length === 0 && !silent) {
    const ok = confirm('Como orquestador, conviene elegir al menos un agente. ¿Continuar sin agentes coordinados?');
    if (!ok) return false;
  }
  return true;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  setTimeout(() => {
    els.toast.hidden = true;
  }, 4000);
}

function render() {
  renderSteps();
  renderPanel();
  renderPreview();
}

function goNext() {
  if (draft.step < 6) {
    if (!validateStep(draft.step)) return;
    draft.step += 1;
    render();
    document.getElementById('builder-panel')?.querySelector('h1')?.focus?.();
  } else {
    if (draft.dirty && !confirm('¿Salir del asistente? Los cambios no guardados se perderán al abandonar sin guardar borrador.')) return;
    skipDiscardCheck = true;
    location.href = './?vista=agentes';
  }
}

function goBack() {
  if (draft.step > 1) {
    draft.step -= 1;
    render();
  }
}

function tryCancel() {
  if (draft.dirty && !confirm('¿Descartar cambios y volver al catálogo?')) return;
  skipDiscardCheck = true;
  location.href = './?vista=agentes';
}

els.next.addEventListener('click', goNext);
els.back.addEventListener('click', goBack);
els.cancel.addEventListener('click', tryCancel);
window.addEventListener('beforeunload', (e) => {
  if (!skipDiscardCheck && draft.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.getElementById('toggle-preview')?.addEventListener('click', () => {
  document.getElementById('builder-preview')?.classList.toggle('is-collapsed');
});

const params = new URLSearchParams(location.search);
const draftId = params.get('borrador');
if (draftId) {
  const loaded = loadDraft(draftId);
  if (loaded) draft = { ...defaultDraft(), ...loaded, dirty: false };
}

if (params.get('plantilla') === 'cobrador') {
  const t = DEMO_TEMPLATES.cobrador;
  draft = { ...defaultDraft(), ...t, templateKey: 'cobrador', mode: t.mode };
}

render();
