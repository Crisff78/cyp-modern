import { useLayoutEffect, useRef } from "react";

/** Optional demonstration controls. Values never enter React drafts, FormData or API requests. */
export function TemporaryCardField({ kind, locked, onValidityChange }: {
  kind: "expiry" | "cvv"; locked: boolean; onValidityChange: (error?: string, cleared?: boolean) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const notify = useRef(onValidityChange);
  useLayoutEffect(() => { notify.current = onValidityChange; });
  useLayoutEffect(() => {
    if (locked && field.current) { field.current.value = ""; field.current.defaultValue = ""; }
  }, [locked]);
  useLayoutEffect(() => {
    const input = field.current!;
    const clear = () => { input.value = ""; input.defaultValue = ""; input.setCustomValidity(""); notify.current(undefined, true); };
    const visibility = () => { if (document.visibilityState === "hidden") clear(); };
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", visibility);
      input.value = ""; input.defaultValue = ""; input.setCustomValidity("");
    };
  }, []);
  const message = kind === "expiry" ? "Usa MM/YY con un mes de 01 a 12." : "Usa 3 o 4 dígitos.";
  const validDraft = (value: string) => kind === "expiry" ? /^[0-9]{0,2}\/?[0-9]{0,2}$/.test(value) : /^[0-9]{0,4}$/.test(value);
  const edit = (input: HTMLInputElement, value: string) => {
    if (locked) { input.value = ""; return; }
    if (!validDraft(value)) { input.value = ""; input.setCustomValidity(message); notify.current(message); return; }
    const digits = value.replace("/", "");
    input.value = kind === "expiry" && digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    const complete = !digits || (kind === "expiry" ? /^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(input.value) : /^[0-9]{3,4}$/.test(digits));
    input.setCustomValidity(complete ? "" : message); notify.current(complete ? undefined : message);
  };
  return <label>{kind === "expiry" ? "Vencimiento (MM/YY)" : "CVV"}<input ref={field} type={kind === "cvv" ? "password" : "text"}
    inputMode="numeric" autoComplete="off" spellCheck={false} autoCapitalize="off" disabled={locked}
    maxLength={kind === "expiry" ? 5 : 4} placeholder={kind === "expiry" ? "MM/YY" : "CVV"} title={message}
    onKeyDown={(event) => { if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !(kind === "expiry" ? /^[0-9/]$/ : /^[0-9]$/).test(event.key)) { event.preventDefault(); notify.current(message); } }}
    onPaste={(event) => {
      event.preventDefault(); const input = event.currentTarget;
      const next = input.value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd ?? input.value.length);
      if (!validDraft(next)) { notify.current(message); return; } edit(input, next);
    }}
    onChange={(event) => edit(event.currentTarget, event.currentTarget.value)}
    onBlur={(event) => edit(event.currentTarget, event.currentTarget.value)} /></label>;
}
