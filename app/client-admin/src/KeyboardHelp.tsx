import { KEYBOARD_MOVES } from "../../shared/keyboard";
import "./keyboard-help.css";

/** The keys of CyP: the same in every window (shared/keyboard.ts). Shown in Soporte Técnico. */
export function KeyboardShortcutsTable() {
  return (
    <section className="keyboard-help" aria-label="Usar CyP solo con el teclado">
      <strong>Usar CyP solo con el teclado</strong>
      <table>
        <tbody>{KEYBOARD_MOVES.map((item) => <tr key={item.key}><th scope="row"><kbd>{item.key}</kbd></th><td>{item.label}</td></tr>)}</tbody>
      </table>
      <p>El dinero se confirma siempre con su botón: Intro llega a él sin pulsarlo. ¿Hiciste clic fuera? Una flecha devuelve el teclado.</p>
    </section>
  );
}
