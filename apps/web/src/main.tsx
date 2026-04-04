import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

interface RendererCrashDetails {
  title: string;
  message: string;
  stack?: string;
}

interface RendererCrashBoundaryState {
  error: RendererCrashDetails | null;
}

class RendererCrashBoundary extends Component<{ children: ReactNode }, RendererCrashBoundaryState> {
  state: RendererCrashBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: unknown): RendererCrashBoundaryState {
    return {
      error: normalizeErrorDetails(error, "Renderer component crash")
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("Renderer component crash", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <RendererCrashScreen details={this.state.error} />;
    }

    return this.props.children;
  }
}

function normalizeErrorDetails(error: unknown, fallbackTitle: string): RendererCrashDetails {
  if (error instanceof Error) {
    return {
      title: fallbackTitle,
      message: error.message,
      stack: error.stack
    };
  }

  if (typeof error === "string") {
    return {
      title: fallbackTitle,
      message: error
    };
  }

  return {
    title: fallbackTitle,
    message: "Unknown renderer error"
  };
}

function RendererCrashScreen({ details }: { details: RendererCrashDetails }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background:
          "radial-gradient(circle at top, rgba(255, 157, 35, 0.18), transparent 38%), #070c13",
        color: "#f8fbff",
        fontFamily: "system-ui, sans-serif"
      }}
    >
      <section
        style={{
          width: "min(860px, 100%)",
          padding: "24px",
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(10, 16, 24, 0.92)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)"
        }}
      >
        <p style={{ margin: 0, color: "#ff9d23", fontSize: "0.8rem", letterSpacing: "0.12em" }}>
          Renderer Crash
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: "1.6rem" }}>{details.title}</h1>
        <p style={{ margin: 0, color: "rgba(248,251,255,0.88)" }}>{details.message}</p>
        {details.stack ? (
          <pre
            style={{
              margin: "20px 0 0",
              padding: "16px",
              borderRadius: "14px",
              background: "rgba(0,0,0,0.32)",
              color: "rgba(248,251,255,0.82)",
              fontSize: "0.82rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {details.stack}
          </pre>
        ) : null}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element was not found.");
}

const root = createRoot(rootElement);

function renderRendererCrash(details: RendererCrashDetails) {
  console.error(details.title, details.message, details.stack ?? "");
  root.render(<RendererCrashScreen details={details} />);
}

window.addEventListener("error", (event) => {
  renderRendererCrash(
    normalizeErrorDetails(event.error ?? event.message, "Unhandled renderer error")
  );
});

window.addEventListener("unhandledrejection", (event) => {
  renderRendererCrash(normalizeErrorDetails(event.reason, "Unhandled renderer rejection"));
});

root.render(
  <StrictMode>
    <RendererCrashBoundary>
      <App />
    </RendererCrashBoundary>
  </StrictMode>
);
