import { Icon } from '@/shared/ui';
import { CHATGPT_BILLING_ROWS, CHATGPT_PLAN_TERMS, PAYER_LABELS } from '../model/legal';

export function ChatGPTPlanExplanation() {
  return (
      <div className="uon-chatgpt-card">
        <p className="uon-chatgpt-card-title">
          <Icon name="uony" size={16} />
          Cómo trabaja Uony con tu plan de ChatGPT
        </p>
        <ul className="uon-chatgpt-terms">
          {CHATGPT_PLAN_TERMS.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <table className="uon-chatgpt-table">
          <caption>Qué usa tu plan de ChatGPT y qué usa tokens de Uonify</caption>
          <thead>
            <tr>
              <th scope="col">Función</th>
              <th scope="col">Con tu plan conectado</th>
            </tr>
          </thead>
          <tbody>
            {CHATGPT_BILLING_ROWS.map(row => (
              <tr key={row.feature}>
                <th scope="row">{row.feature}</th>
                <td data-payer={row.payer}>{PAYER_LABELS[row.payer]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}
