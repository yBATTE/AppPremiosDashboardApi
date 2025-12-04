# -------- STAGE 1: build (TypeScript -> JS) --------
FROM node:20-slim AS build

WORKDIR /app

# Sólo los manifests para resolver deps
COPY package*.json ./

# Instala TODAS las deps (incluye devDependencies para compilar TS)
RUN npm ci

# Copiamos el código fuente TS y config
COPY tsconfig.json ./
COPY src ./src

# Compila a dist/
RUN npm run build

# -------- STAGE 2: runtime --------
FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

# Sólo deps de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Copiamos el JS ya compilado
COPY --from=build /app/dist ./dist

# El puerto interno de la API
EXPOSE 3000

# Si tu entrypoint es otro, ajustá esta ruta:
CMD ["node", "dist/index.js"]
