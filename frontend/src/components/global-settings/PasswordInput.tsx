import { Eye } from 'lucide-react';
import { EyeOff } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const PasswordInput = ({
  value,
  onChange,
  placeholder = '••••••••',
  className = 'gnosi-input',
  style,
  name,
  id,
  autoComplete = 'current-password',
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) => {
  const [show, setShow] = React.useState(false);
  const { t } = useTranslation();
  const labelShow = t('subs_news_password_show');
  const labelHide = t('subs_news_password_hide');
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        type={show ? 'text' : 'password'}
        className={className}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        name={name}
        id={id}
        autoComplete={autoComplete}
        style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box', ...style }}
      />
      <button
        type="button"
        onClick={() => { setShow(s => !s); }}
        aria-label={show ? labelHide : labelShow}
        title={show ? labelHide : labelShow}
        style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0', display: 'flex', alignItems: 'center' }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
};
