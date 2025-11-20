# Premios API (backend simple)

Backend mínimo en Node + Express + MongoDB para manejar usuarios y login con JWT.

Por ahora solo maneja:

- Usuarios en MongoDB (solo rol VIEWER si querés).
- Endpoint de login `POST /api/auth/login`.
- Endpoint `GET /api/auth/me` para validar el token.

## Requisitos

- Node 18+
- MongoDB local o remoto (Atlas, etc.)

## Configuración

1. Copiá `.env.example` a `.env`:

```bash
cp .env.example .env
```

2. Editá `.env` y poné:

- `MONGO_URI` con la URL de tu Mongo.
- `JWT_SECRET` con un string largo y secreto.
- `SEED_EMAIL` y `SEED_PASSWORD` para el primer usuario.

## Instalar dependencias

```bash
npm install
```

## Crear el primer usuario

```bash
npm run seed
```

Eso crea un usuario con el mail y contraseña que pusiste en `.env`.

## Levantar la API

```bash
npm run dev
```

La API queda en:

- `http://localhost:3000/api/auth/login`
- `http://localhost:3000/api/auth/me`
- `http://localhost:3000/api/health`

## Ejemplo de login (request)

`POST http://localhost:3000/api/auth/login`

Body JSON:

```json
{
  "email": "admin@grupogen.com.ar",
  "password": "123456"
}
```

Respuesta:

```json
{
  "token": "jwt...",
  "user": {
    "id": ".....",
    "email": "admin@grupogen.com.ar",
    "role": "VIEWER"
  }
}
```

Ese `token` lo usás en el frontend en el header:

```http
Authorization: Bearer TOKEN
```
