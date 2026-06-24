import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = {
  children: ReactNode
  onReset?: () => void
  label?: string
}

type State = {
  error: Error | null
  info: ErrorInfo | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error, info)
  }

  reset = () => {
    this.setState({ error: null, info: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            padding: "24px",
            background: "#1a0202",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: "13px",
            overflow: "auto",
          }}
        >
          <h2 style={{ fontSize: "18px", marginBottom: "12px", color: "#ff5f5f" }}>
            Error en {this.props.label || "el componente"}
          </h2>
          <div
            style={{
              background: "rgba(0,0,0,0.5)",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "12px",
              border: "1px solid #861414",
            }}
          >
            <div style={{ fontWeight: "bold", color: "#ff9b9b", marginBottom: "6px" }}>
              {this.state.error.name}: {this.state.error.message}
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                color: "#ccc",
                fontSize: "11px",
                lineHeight: 1.5,
              }}
            >
              {this.state.error.stack}
            </pre>
          </div>
          {this.state.info?.componentStack && (
            <div
              style={{
                background: "rgba(0,0,0,0.5)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #333",
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "6px", color: "#86efac" }}>
                Component stack:
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  color: "#bbb",
                  fontSize: "11px",
                  lineHeight: 1.5,
                }}
              >
                {this.state.info.componentStack}
              </pre>
            </div>
          )}
          <button
            onClick={this.reset}
            style={{
              marginTop: "16px",
              padding: "10px 20px",
              background: "#ef1313",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
              fontFamily: "monospace",
            }}
          >
            Cerrar y volver
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
