import { useState } from "react";
import { INPUT_LIMITS } from "./inputRules";
import "./login-password.css";

export function LoginPasswordInput({ id, value, onChange, minLength, disabled = false }: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
  disabled?: boolean;
}>) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  // Native autofill owns the current DOM value. The login form reads it on
  // submit, so toggling visibility cannot overwrite it with stale React state.
  return <span className="cyp-login-password">
    <input id={id} name="password" aria-label="Contraseña" type={visible ? "text" : "password"}
      required autoComplete="current-password" maxLength={INPUT_LIMITS.password} minLength={minLength}
      placeholder="Tu contraseña" defaultValue={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" className="icon-button cyp-password-toggle" aria-label={label} title={label}
      aria-controls={id} aria-pressed={visible} disabled={disabled} onClick={() => setVisible((current) => !current)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </span>;
}

export function PasswordManagerHint() {
  return <p className="cyp-password-manager-hint">Puedes guardar y completar tu contraseña con el gestor de tu navegador.</p>;
}
