# Configuración: variables de entorno

Referencia de cada variable de entorno de omero-social-post. Sale de dos archivos de ejemplo:

- [`infra/.env.example`](../../infra/.env.example): producción con Docker Compose. Va en `/opt/omero/.env`.
- [`apps/api/.env.example`](../../apps/api/.env.example): desarrollo local. Va en `apps/api/.env`.

Las variables que solo aparecen en uno de los dos archivos lo indican. La validación está en [`apps/api/src/config/env.schema.ts`](../../apps/api/src/config/env.schema.ts): si falta una obligatoria o un par está incompleto, la API no arranca y dice cuál es.

English version: [configuration.md](../en/configuration.md).

## Reglas generales

- **Obligatoria:** sin valor, la API no arranca.
- **Opcional:** la app funciona sin ella. La función relacionada queda deshabilitada o usa un valor por defecto.
- **Pares:** `X_CLIENT_ID` con `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID` con `LINKEDIN_CLIENT_SECRET`, y `TELEGRAM_BOT_TOKEN` con `TELEGRAM_CHAT_ID`. Se configuran de a dos: ambas o ninguna.
- **Secretos:** nunca los subas al repo. El `.env` real está en `.gitignore`, y gitleaks corre en pre-commit y en CI.

## Despliegue (solo Docker Compose)

| Variable        | Obligatoria | Por defecto | Descripción                                                                                                                                                          |
| --------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OMERO_VERSION` | No          | `latest`    | Etiqueta de las imágenes `api` y `web` en GHCR: `latest`, una versión (`0.1.0`) o un commit (`sha-<commit>`). Fijar una versión hace explícitas las actualizaciones. |

## Aplicación

| Variable           | Obligatoria           | Por defecto                                                | Descripción                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | No                    | `production` en compose; `development` en el ejemplo local | `development`, `test` o `production`.                                                                                                                                                                                                                                                                    |
| `PORT`             | No                    | `4000`                                                     | Puerto donde escucha la API. Compose lo fija en `4000`.                                                                                                                                                                                                                                                  |
| `HOST`             | No                    | `0.0.0.0` en contenedores; `127.0.0.1` en desarrollo       | Interfaz donde escucha la API. Solo en `apps/api/.env.example`; compose lo fija.                                                                                                                                                                                                                         |
| `LOG_LEVEL`        | No                    | `info`                                                     | Nivel de log: `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent`. Solo en `apps/api/.env.example`.                                                                                                                                                                                            |
| `PUBLIC_BASE_URL`  | **Sí**                | Ninguno                                                    | URL pública de la app, sin barra final. En producción es `https://<host>.<tailnet>.ts.net`; en local, `http://localhost:3000`. Se usa en los callbacks de OAuth, en los enlaces de las notificaciones y en el chequeo de `Origin` contra CSRF. Tiene que coincidir exactamente con la URL del navegador. |
| `API_INTERNAL_URL` | No (solo al compilar) | `http://api:4000` en la imagen publicada                   | URL con la que el servidor web llega a la API. Se hornea en `next build`, así que el contenedor web en ejecución no la lee. Solo hace falta si compilás la imagen web.                                                                                                                                   |

## Base de datos y Redis

| Variable       | Obligatoria | Por defecto | Descripción                                                                                                                                                                                         |
| -------------- | ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | **Sí**      | Ninguno     | Conexión a PostgreSQL: `postgres://usuario:clave@host:5432/base`. En compose el host es `postgres`; en desarrollo, `127.0.0.1`. Si la clave tiene caracteres como `@ : / ? # %`, codificala en URL. |
| `REDIS_URL`    | **Sí**      | Ninguno     | Conexión a Redis 8, que usa BullMQ. En compose: `redis://redis:6379/0`. En desarrollo: `redis://127.0.0.1:6379/0`.                                                                                  |

## Seguridad

| Variable         | Obligatoria | Por defecto | Descripción                                                                                                                                                                                                    |
| ---------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY` | **Sí**      | Ninguno     | 32 bytes en base64, para cifrar los tokens de OAuth en la base (AES-256-GCM). Generala con `openssl rand -base64 32`. Guardá una copia fuera del servidor: si se pierde, hay que reconectar todos los canales. |

## Medios y workers

| Variable          | Obligatoria | Por defecto                                       | Descripción                                                                                                                                                          |
| ----------------- | ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_DIR`       | No          | `/data/media` en compose; `./media-data` en local | Directorio donde se guardan las imágenes subidas. En Docker va en un volumen.                                                                                        |
| `WORKERS_ENABLED` | No          | `true`                                            | Ejecuta los workers de BullMQ (publicación, métricas y reconciliador) dentro del proceso de la API. Ponelo en `false` solo si los workers corren en otro contenedor. |

## Redes sociales (opcionales, de a pares)

| Variable                 | Obligatoria                           | Por defecto | Descripción                                                                                                                                                                   |
| ------------------------ | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X_CLIENT_ID`            | No (par con `X_CLIENT_SECRET`)        | Vacío       | Client ID de tu app de X ([developer.x.com](https://developer.x.com)), con OAuth 2.0 activado. Sin este par, "Conectar X" queda deshabilitado en Ajustes → Canales.           |
| `X_CLIENT_SECRET`        | No (par con `X_CLIENT_ID`)            | Vacío       | Client Secret de la misma app de X.                                                                                                                                           |
| `LINKEDIN_CLIENT_ID`     | No (par con `LINKEDIN_CLIENT_SECRET`) | Vacío       | Client ID de tu app de LinkedIn, con los productos _Share on LinkedIn_ y _Sign In with LinkedIn using OpenID Connect_. Sin este par, "Conectar LinkedIn" queda deshabilitado. |
| `LINKEDIN_CLIENT_SECRET` | No (par con `LINKEDIN_CLIENT_ID`)     | Vacío       | Client Secret de la misma app de LinkedIn.                                                                                                                                    |

Las URLs de callback que hay que registrar en cada portal se construyen con `PUBLIC_BASE_URL`:

- X: `${PUBLIC_BASE_URL}/api/v1/channels/x/callback`
- LinkedIn: `${PUBLIC_BASE_URL}/api/v1/channels/linkedin/callback`

## Notificaciones de Telegram (opcionales, de a pares)

| Variable             | Obligatoria                       | Por defecto | Descripción                                                                                                                        |
| -------------------- | --------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | No (par con `TELEGRAM_CHAT_ID`)   | Vacío       | Token del bot que creás con @BotFather.                                                                                            |
| `TELEGRAM_CHAT_ID`   | No (par con `TELEGRAM_BOT_TOKEN`) | Vacío       | Tu chat id. Lo obtenés con @userinfobot o con `getUpdates` del bot. Sin ambas variables, las notificaciones quedan solo en la app. |

## PostgreSQL (solo compose)

Compose usa estas variables para crear la base la primera vez que arranca el contenedor de Postgres. Tienen que coincidir con `DATABASE_URL`.

| Variable            | Obligatoria      | Por defecto | Descripción                                                                                                    |
| ------------------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | **Sí** (compose) | Ninguno     | Usuario de la base. Debe ser el mismo que en `DATABASE_URL`.                                                   |
| `POSTGRES_PASSWORD` | **Sí** (compose) | Ninguno     | Contraseña. Debe ser la misma que en `DATABASE_URL`. Postgres solo la usa al crear el volumen por primera vez. |
| `POSTGRES_DB`       | **Sí** (compose) | Ninguno     | Nombre de la base. Debe ser el mismo que en `DATABASE_URL`.                                                    |

## Variables del ejemplo local que no van en compose

El ejemplo de desarrollo trae `DATABASE_URL` y `REDIS_URL` apuntando a `127.0.0.1`, y `MEDIA_DIR=./media-data`. `pnpm infra:up` levanta Postgres y Redis en `127.0.0.1` con credenciales de desarrollo que coinciden con ese ejemplo.
