import { MODULES, launcherIconSvg } from './module-launcher.mjs';

/** Rejilla de aplicaciones (mismo catálogo e iconos que el menú de nueve puntos). */
export default function ModuleAppsGrid({ currentApp = 'uonify' }) {
  return (
    <nav className="module-apps-grid" aria-label="Aplicaciones Uonify">
      {MODULES.map((module) => {
        const body = (
          <>
            <span
              className={`module-apps-icon ${module.color}`}
              dangerouslySetInnerHTML={{ __html: launcherIconSvg(module.icon) }}
            />
            <span className="module-apps-name">{module.name}</span>
            <small>{module.id === currentApp ? 'Estás aquí' : module.href ? 'Abrir aplicación' : 'Pendiente'}</small>
          </>
        );
        if (module.id === currentApp) {
          return (
            <div key={module.id} className="module-apps-tile current" aria-current="page">
              {body}
            </div>
          );
        }
        if (module.href) {
          return (
            <a key={module.id} className="module-apps-tile" href={module.href} target="_self">
              {body}
            </a>
          );
        }
        return (
          <div key={module.id} className="module-apps-tile is-pending" aria-disabled="true">
            {body}
          </div>
        );
      })}
    </nav>
  );
}
