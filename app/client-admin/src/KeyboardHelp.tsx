import { KEYBOARD_MOVES, KEYBOARD_SHORTCUTS } from "../../shared/keyboard";
import { Modal } from "./components";
import "./keyboard-help.css";

/** The keys of CyP: the same in every window (shared/keyboard.ts). Shown by F1 and in Soporte Técnico. */
export function KeyboardShortcutsTable() {
  return (
    <section className="keyboard-help" aria-label="Usar CyP solo con el teclado">
      <strong>Usar CyP solo con el teclado</strong>
      <p>Las mismas teclas en todas las ventanas. El botón que responde a una tecla la muestra en su esquina.</p>
      <div className="keyboard-help-columns">
        <table>
          <caption>Teclas de acción</caption>
          <tbody>{KEYBOARD_SHORTCUTS.map((item) => <tr key={item.key}><th scope="row"><kbd>{item.key}</kbd></th><td>{item.label}</td></tr>)}</tbody>
        </table>
        <table>
          <caption>Moverse</caption>
          <tbody>{KEYBOARD_MOVES.map((item) => <tr key={item.key}><th scope="row"><kbd>{item.key}</kbd></th><td>{item.label}</td></tr>)}</tbody>
        </table>
      </div>
      <p>El dinero se confirma siempre con su botón o con F9, nunca con un Intro sin querer.</p>
    </section>
  );
}

export function KeyboardHelpDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return (
    <Modal open={open} onClose={onClose} title="Teclas de CyP" description="F1 abre esta ayuda en cualquier momento. Esc la cierra." className="keyboard-help-dialog">
      <KeyboardShortcutsTable />
    </Modal>
  );
}
