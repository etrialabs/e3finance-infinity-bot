# e3finance

Dashboard web estático.

## Estructura

```
├── index.html              # Página principal
├── styles.css              # Estilos
├── app.js                  # Lógica
├── manifest.webmanifest    # Config PWA
└── assets/                 # Favicons e iconos
```

## Deploy

Este es un sitio estático. Se puede desplegar directamente en:

- **GitHub Pages** — Settings → Pages → Deploy from branch → `main` / root
- **Cloudflare Pages** — Conecta el repo, build command vacío, output directory `/`
- **Netlify** — Drag & drop de la carpeta o conexión con el repo
- **Vercel** — Import del repo, framework preset: "Other"

## Desarrollo local

Abrir `index.html` directamente en el navegador, o con un servidor local:

```bash
npx serve .
# o
python3 -m http.server 8000
```

## Dependencias externas (via CDN)

- Chart.js 4.4.0
- Google Fonts: Cormorant Garamond, Inter, JetBrains Mono
