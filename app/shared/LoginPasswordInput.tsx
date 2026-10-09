import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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
  return <span className="cyp-login-password">
    <input id={id} name="password" aria-label="Contraseña" type={visible ? "text" : "password"}
      required autoComplete="current-password" maxLength={INPUT_LIMITS.password} minLength={minLength}
      placeholder="Tu contraseña" value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" className="icon-button cyp-password-toggle" aria-label={label} title={label}
      aria-controls={id} aria-pressed={visible} disabled={disabled} onClick={() => setVisible((current) => !current)}>
      {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
    </button>
  </span>;
}

export function PasswordManagerHint() {
  return <p className="cyp-password-manager-hint">Puedes guardar y completar tu contraseña con el gestor de tu navegador.</p>;
}
