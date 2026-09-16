import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fullscreen-state">
        <h1>Necesitamos volver a cargar</h1>
        <p>Ocurrió un problema al mostrar esta pantalla.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Volver a cargar
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster position="top-center" richColors closeButton />
    </ErrorBoundary>
  </React.StrictMode>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* App remains usable if browser blocks service workers. */
    });
  });
