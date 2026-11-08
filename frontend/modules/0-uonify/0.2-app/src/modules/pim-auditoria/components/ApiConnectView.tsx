import { Fragment } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { API_CONNECTIONS } from '../model/apiConnections';
import type { ApiConnectionState } from '../hooks/useApiConnection';

/**
 * Panel «Conectar API»: plataformas como pim-option (aria-pressed = elegida),
 * credenciales en dos columnas en mono y «Probar Conexión», la única acción sólida.
 */
export function ApiConnectView({ state, idPrefix }: { state: ApiConnectionState; idPrefix: string }) {
  const current = state.selected;
  return (
    <div className="pim-auditoria-stack">
      <div className="pim-auditoria-stack-sm">
        <span className="pim-auditoria-label-lg" id={`${idPrefix}-platform`}>Seleccionar Plataforma</span>
        <div className="pim-auditoria-platforms" role="group" aria-labelledby={`${idPrefix}-platform`}>
          {API_CONNECTIONS.map(connection => (
            <button
              key={connection.id}
              type="button"
              className="pim-option pim-auditoria-platform"
              aria-pressed={current?.id === connection.id}
              data-focus={`platform:${connection.id}`}
              onClick={() => state.selectPlatform(connection.id)}
            >
              <span className="pim-auditoria-emoji" aria-hidden="true">{connection.icon}</span>
              <span className="pim-auditoria-platform-text">
                <strong>{connection.name}</strong>
                <small>{connection.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      {current ? (
        <Fragment key={current.id}>
          <hr className="pim-divider" />
          <div className="pim-auditoria-stack">
            <div className="pim-auditoria-api-selected">
              <span className="pim-auditoria-emoji" aria-hidden="true">{current.icon}</span>
              <div>
                <h4 className="pim-auditoria-api-name">{current.name}</h4>
                <p className="pim-hint">{current.description}</p>
              </div>
            </div>
            <div className="pim-auditoria-stack-sm">
              <span className="pim-auditoria-label-lg">Credenciales de Conexión</span>
              <div className="pim-auditoria-grid">
                {Object.entries(current.fields).map(([field, config]) => {
                  const inputId = `${idPrefix}-${field}`;
                  const isPassword = config.type === 'password';
                  const visible = !isPassword || Boolean(state.showPasswords[field]);
                  const eyeLabel = `${state.showPasswords[field] ? 'Ocultar' : 'Mostrar'} ${config.label}`;
                  const common = {
                    id: inputId,
                    className: 'pim-mono',
                    'data-focus': `cred:${field}`,
                    'aria-required': config.required || undefined,
                    placeholder: config.placeholder,
                    value: state.credentials[field] || '',
                  };
                  return (
                    <div key={field} className="pim-field">
                      <label className="pim-label pim-auditoria-label-start" htmlFor={inputId}>
                        {config.label}
                        {config.required ? <span className="pim-auditoria-req" aria-hidden="true">*</span> : null}
                      </label>
                      <div className={clsx('pim-auditoria-secret', isPassword && 'pim-auditoria--toggle')}>
                        {config.type === 'textarea' ? (
                          <textarea {...common} className="pim-textarea pim-mono" onChange={event => state.setCredential(field, event.target.value)} />
                        ) : (
                          <input
                            {...common}
                            className="pim-input pim-mono"
                            type={visible ? 'text' : 'password'}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={event => state.setCredential(field, event.target.value)}
                          />
                        )}
                        {isPassword ? (
                          <button
                            type="button"
                            className="pim-btn pim-btn-ghost pim-btn-icon pim-btn-sm pim-auditoria-eye"
                            data-focus={`eye:${field}`}
                            aria-pressed={Boolean(state.showPasswords[field])}
                            aria-label={eyeLabel}
                            data-tooltip={eyeLabel}
                            data-tooltip-align="end"
                            onClick={() => state.togglePassword(field)}
                          >
                            <Icon name={state.showPasswords[field] ? 'eye-off' : 'eye'} size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pim-auditoria-test-row">
              <button
                type="button"
                className="pim-btn pim-btn-primary"
                data-focus="api-test"
                disabled={state.isConnecting}
                onClick={() => void state.testConnection()}
              >
                {state.isConnecting
                  ? <><Icon name="loader" size={16} className="pim-spin" /> Conectando...</>
                  : <><Icon name="settings" size={16} /> Probar Conexión</>}
              </button>
              {state.connectionStatus === 'success' ? (
                <span className="pim-badge pim-badge-blue pim-auditoria-status-badge" role="status">
                  <Icon name="info" size={14} />Campos completos
                </span>
              ) : null}
              {state.connectionStatus === 'error' ? (
                <span className="pim-badge pim-badge-red pim-auditoria-status-badge" role="status">
                  <Icon name="alert-triangle" size={14} />Error
                </span>
              ) : null}
            </div>
          </div>
        </Fragment>
      ) : null}
    </div>
  );
}
