import "@fontsource-variable/hanken-grotesk/wght.css"
import "@fontsource-variable/newsreader/wght.css"
import "@fontsource/ibm-plex-mono/latin-400.css"
import "@fontsource/ibm-plex-mono/latin-500.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"
import "./styles.css"

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
