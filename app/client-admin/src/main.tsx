import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./suggestions-shell.css";
import App from "./App";
import { getToken } from "./api";
import { NewVersionNotice } from "../../shared/NewVersionNotice";
import { ADMIN_TOKEN_KEY, COLLECTOR_TOKEN_KEY } from "../../shared/sessionHandoff";
import { startSessionLifetime } from "../../shared/sessionLifetime";

// Before anything reads the token: a tab closed and reopened starts signed out.
startSessionLifetime([ADMIN_TOKEN_KEY, COLLECTOR_TOKEN_KEY]);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>Hagamos una pausa.</h1>
        <p>
          No pudimos mostrar esta pantalla. Tus operaciones guardadas siguen
          disponibles.
        </p>
        <button className="btn primary" onClick={() => location.reload()}>
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
    </ErrorBoundary>
    <NewVersionNotice pageUrl={import.meta.env.BASE_URL} isSignedIn={() => Boolean(getToken())} />
  </React.StrictMode>,
);
