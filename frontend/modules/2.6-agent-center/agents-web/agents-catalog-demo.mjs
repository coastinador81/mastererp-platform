const MODE_LABEL = {
  simple: 'Agente simple',
  orchestrator: 'Coordinador',
};

const PREDEFINED_MODULE_AGENTS = [
  { name: 'Finanzas', mode: 'simple' },
  { name: 'Ecommerce', mode: 'simple' },
  { name: 'Inventario', mode: 'simple' },
  { name: 'CRM', mode: 'orchestrator' },
  { name: 'Marketing', mode: 'simple' },
  { name: 'Servicios', mode: 'simple' },
  { name: 'Transporte', mode: 'simple' },
  { name: 'Productividad', mode: 'orchestrator' },
  { name: 'Punto de venta', mode: 'simple' },
  { name: 'Estudio', mode: 'simple' },
];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function bindAgentRows() {
  document.querySelectorAll('[data-agent]').forEach((row) => {
    const open = () => {
      location.href = `configuracion.html?agente=${encodeURIComponent(row.dataset.agent)}`;
    };
    row.addEventListener('click', (event) => {
      if (!event.target.closest('a')) open();
    });
    row.addEventListener('keydown', (event) => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderPredefinedAgents() {
  const host = document.querySelector('[data-predefined-rows]');
  if (!host) return;
  if (host.querySelector('[data-agent]')) {
    bindAgentRows();
    return;
  }
  host.innerHTML = PREDEFINED_MODULE_AGENTS.map(({ name, mode }) => {
    const href = `configuracion.html?agente=${encodeURIComponent(name)}`;
    const modeLabel = MODE_LABEL[mode] || MODE_LABEL.simple;
    return `<div class="agent-row" data-agent="${escapeHtml(name)}" data-mode="${escapeHtml(mode)}" tabindex="0">
      <strong><a href="${href}" style="color:inherit;text-decoration:none">${escapeHtml(name)}</a></strong>
      <span>${escapeHtml(modeLabel)}</span>
      <span>${escapeHtml(name)}</span>
      <span class="status">Listo</span>
      <span>Base vinculada</span>
    </div>`;
  }).join('');
  bindAgentRows();
}

async function injectDrafts() {
  let drafts = [];
  try {
    const { listDrafts } = await import('./agent-builder-demo.mjs');
    drafts = listDrafts();
  } catch {
    /* borradores locales opcionales */
  }
  const host = document.querySelector('[data-custom-agents]');
  if (!host) return;
  if (!drafts.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const tbody = host.querySelector('[data-draft-rows]');
  tbody.innerHTML = drafts
    .map(
      (d) => `<div class="agent-row" role="row">
      <strong><a href="crear-agente.html?borrador=${encodeURIComponent(d.id)}" style="color:inherit;text-decoration:none">${escapeHtml(d.name)}</a></strong>
      <span>${d.mode === 'orchestrator' ? 'Coordinador' : 'Agente simple'}</span>
      <span>Personalizado</span>
      <span class="status">Borrador</span>
      <span>${d.capabilities.length} capacidades</span>
    </div>`,
    )
    .join('');
}

renderPredefinedAgents();
injectDrafts();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) injectDrafts();
});
