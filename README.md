# omero-social-post

**Tu propio publicador de redes sociales, en tu servidor.**
Una alternativa self-hosted a Typefully y Metricool: escribís, programás y publicás en X y LinkedIn desde una instancia que controlás vos.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> 🚧 **Estado: MVP en construcción.** Todavía no hay una versión usable. El código se está escribiendo en público, tarea por tarea, siguiendo el plan en [`AiBuild/`](AiBuild/).

[Español](#español) · [English](#english)

## Documentación / Docs

- **Español:** guía de self-hosting, configuración, arquitectura y cómo agregar una red, en [`docs/`](docs/README.md).
- **English:** self-hosting guide, configuration, architecture and how to add a network, in [`docs/`](docs/README.md).

---

## Español

### Qué es

**omero-social-post** es un publicador de redes sociales **open source**, **self-hosted** y **de un solo usuario**.

- **Tuyo:** corre en tu VPS (o en tu máquina) con Docker Compose. Pensado para quedar privado detrás de [Tailscale](https://tailscale.com), sin nada expuesto a internet.
- **Liviano:** diseñado para entrar cómodo en un VPS de 1 vCPU / 4 GB.
- **Solo APIs oficiales:** se conecta a cada red con su OAuth oficial. Nada de scraping ni endpoints no oficiales.
- **Traés tus propias claves:** cada instancia usa sus propias apps de desarrollador de X y LinkedIn.

### Funcionalidades de la etapa 1 (MVP)

- **Cuenta de dueño:** setup inicial y login propio (además de Tailscale).
- **Canales:** conectar X y un perfil personal de LinkedIn con OAuth oficial; desconectar y reconectar.
- **Composer:**
  - contenido base con ajustes por red (por ejemplo, un hilo en X y un post largo en LinkedIn);
  - hilos de X, con separación manual o automática respetando el límite de caracteres;
  - imágenes;
  - contador de caracteres, validaciones y vista previa por red;
  - aviso cuando un post de X lleva un link (cuesta más en la API de X).
- **Programación:** guardar borrador, programar a fecha y hora, agregar a la cola (próximo slot libre de tu grilla semanal) o publicar ya.
- **Calendario:** vistas semana y mes, crear desde un slot vacío y reprogramar arrastrando (con deshacer).
- **Scheduler confiable:**
  - publica cada red por separado;
  - reintenta errores transitorios con backoff exponencial;
  - retoma hilos desde el ítem que falló;
  - publica al arrancar lo que quedó pendiente dentro de una ventana de gracia.
- **Notificaciones:** fallas y canales que necesitan reconexión, dentro de la app y por Telegram (con tu propio bot).
- **Métricas básicas de X:** impresiones, likes, reposts, respuestas, citas y guardados a +1 h, +24 h y +7 d.
- **Interfaz en español primero**, con i18n preparado para sumar otros idiomas.

### Roadmap

Cada etapa es un ciclo SDD propio:

1. **`mvp/core-publishing`**: monorepo, publicación en X + LinkedIn, composer, calendario y scheduler. _(en curso)_
2. **`feature/news-digest`**: fuentes (cuentas de X, sitios web/RSS), investigación con IA e ideas que se convierten en borradores en el calendario.
3. **`feature/mobile-app`**: app Expo para aprobar borradores, leer el digest, crear borradores desde la galería y recibir push.
4. **`feature/meta-networks`**: Instagram (cuenta profesional) y páginas de Facebook.

### Stack

| Capa            | Tecnología                                                                         |
| --------------- | ---------------------------------------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                                                        |
| Web             | Next.js (App Router), Tailwind, shadcn/ui, FullCalendar, next-intl, TanStack Query |
| API + scheduler | NestJS, BullMQ (workers en el mismo proceso)                                       |
| Datos           | PostgreSQL 17 + Drizzle ORM, Redis 8 (colas)                                       |
| Contratos       | zod compartido en `packages/shared`, OpenAPI → cliente tipado con orval            |
| Tests           | Vitest, Testcontainers, msw                                                        |
| Deploy          | Docker Compose, imágenes construidas en GitHub Actions, Tailscale                  |
| Seguridad       | gitleaks (pre-commit + CI), Dependabot, tokens OAuth cifrados con AES-256-GCM      |

### Construido en público con Spec Driven Development

Todo el proceso es parte del proyecto. Antes de escribir código, cada etapa pasa por una **spec funcional**, una **spec técnica** y un **plan de tareas**, y después se construye tarea por tarea con ayuda de IA.

Todo eso está versionado en [`AiBuild/`](AiBuild/):

- [Spec funcional de la etapa 1](AiBuild/mvp/core-publishing/WIP/functional-spec.md)
- [Spec técnica](AiBuild/mvp/core-publishing/WIP/technical-spec.md)
- [Plan de tareas](AiBuild/mvp/core-publishing/WIP/plan.md)

### Inicio rápido (desarrollo)

**Requisitos:**

- Node.js 22 (ver [`.nvmrc`](.nvmrc));
- pnpm 10 (`corepack enable` toma la versión de `packageManager`);
- Docker con Docker Compose;
- [gitleaks](https://github.com/gitleaks/gitleaks#installing), recomendado para el hook de pre-commit.

```bash
git clone https://github.com/Avesousa/omero-social-post.git
cd omero-social-post
pnpm install                         # también instala los git hooks (lefthook)

cp infra/.env.example infra/.env     # completá los valores (ver comentarios en el archivo)
pnpm infra:up                        # Postgres + Redis locales, solo en 127.0.0.1

pnpm dev
```

> 🚧 Los pasos de migraciones de base de datos, el primer arranque de la app y las URLs locales se documentan acá a medida que se construyen (tareas T003, T007, T008 y T013 del plan).

Comandos útiles:

```bash
pnpm lint          # ESLint en todo el monorepo
pnpm typecheck     # TypeScript
pnpm test          # Vitest
pnpm format        # Prettier (escribe)
pnpm format:check  # Prettier (solo verifica, lo mismo que corre en CI)
pnpm build
```

### Self-hosting: traés tus propias apps de desarrollador

omero-social-post no ofrece apps compartidas: cada instancia usa **sus propias credenciales**, cargadas por variables de entorno. La interfaz nunca te las pide.

- **X:**
  - creá una app en el [X Developer Portal](https://developer.x.com) con OAuth 2.0 (tipo Web App);
  - callback: `${PUBLIC_BASE_URL}/api/v1/channels/x/callback`;
  - la API de X es pay-per-use: la app minimiza lecturas y avisa cuando un post con link cuesta más.
- **LinkedIn:**
  - creá una app en [LinkedIn Developers](https://www.linkedin.com/developers) con los productos _Share on LinkedIn_ y _Sign In with LinkedIn using OpenID Connect_;
  - redirect: `${PUBLIC_BASE_URL}/api/v1/channels/linkedin/callback`;
  - los tokens duran unos 60 días y la app te avisa antes de que venzan.
- **Telegram (opcional):** un bot propio creado con @BotFather para recibir notificaciones.

Si falta una credencial, el botón de conectar esa red queda deshabilitado y te explica qué configurar. Todas las variables están documentadas en [`infra/.env.example`](infra/.env.example).

La guía de deploy en VPS con Docker Compose y Tailscale llega con las últimas tareas de la etapa 1.

### Contribuir

¡Bienvenidas las issues y los PRs! Leé [CONTRIBUTING.md](CONTRIBUTING.md) y el [Código de Conducta](CODE_OF_CONDUCT.md). Para reportar vulnerabilidades, seguí [SECURITY.md](SECURITY.md) (en privado, nunca en una issue pública).

### Licencia

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Si modificás el proyecto y lo ofrecés como servicio en red, tenés que publicar el código fuente de tu versión.

### Agradecimientos

[Postiz](https://github.com/gitroomhq/postiz-app) es la inspiración de producto y una referencia de arquitectura. omero-social-post está escrito desde cero: **no copia código de Postiz**.

---

## English

**Your own social media publisher, on your own server.**
omero-social-post is an **open-source**, **self-hosted**, **single-user** alternative to Typefully and Metricool.
Write, schedule and publish to X and LinkedIn from an instance you control.

> 🚧 **Status: MVP in progress.** There is no usable release yet. It is being built in public, task by task, following the plan in [`AiBuild/`](AiBuild/).

### Highlights

- **Yours:**
  - runs on your VPS (or laptop) with Docker Compose;
  - meant to stay private behind [Tailscale](https://tailscale.com), with nothing exposed to the internet;
  - fits comfortably on a 1 vCPU / 4 GB VPS.
- **Official APIs only:** official OAuth for each network. No scraping, no unofficial endpoints.
- **Bring your own keys:** every instance uses its own X and LinkedIn developer apps.

### Stage 1 features (MVP)

- **Owner account:** first-run setup and its own login.
- **Channels:** connect X and a LinkedIn personal profile.
- **Composer:**
  - per-network overrides;
  - X threads (manual or automatic splitting);
  - images;
  - character counters, validation and per-network previews.
- **Scheduling:** draft, exact date and time, queue (next free weekly slot) or publish now.
- **Calendar:** week and month views, drag to reschedule with undo.
- **Reliable scheduler:**
  - per-network deliveries;
  - retries with exponential backoff;
  - resume a thread from the failed item;
  - catch-up publishing within a grace window after downtime.
- **Notifications:** in-app and through your own Telegram bot.
- **Basic X metrics:** fetched at +1 h, +24 h and +7 d.
- **UI:** Spanish first, i18n-ready.

### Roadmap

1. **`mvp/core-publishing`**: monorepo, X + LinkedIn publishing, composer, calendar, scheduler. _(in progress)_
2. **`feature/news-digest`**: sources (X accounts, websites/RSS), AI research, ideas turned into calendar drafts.
3. **`feature/mobile-app`**: Expo app to approve drafts, read the digest, share-sheet drafts from the gallery, push notifications.
4. **`feature/meta-networks`**: Instagram (professional account) and Facebook Pages.

### Stack

- **Monorepo:** pnpm + Turborepo.
- **Web:** Next.js (App Router), Tailwind and shadcn/ui.
- **API + scheduler:** NestJS with BullMQ.
- **Data:** PostgreSQL 17 + Drizzle, and Redis 8 for queues.
- **Tests:** Vitest, Testcontainers and msw.
- **Deployment:** Docker Compose, with images built in GitHub Actions, behind Tailscale.

See the table in the Spanish section for details.

### Built in public with Spec Driven Development

Every stage starts with a functional spec, a technical spec and a task plan, and is then built task by task with AI assistance. All of it is versioned in [`AiBuild/`](AiBuild/).

### Quick start (development)

You need Node.js 22, pnpm 10 (`corepack enable`), Docker and, ideally, [gitleaks](https://github.com/gitleaks/gitleaks#installing).

```bash
pnpm install                         # also installs git hooks (lefthook)
cp infra/.env.example infra/.env     # fill in the values
pnpm infra:up                        # local Postgres + Redis on 127.0.0.1
pnpm dev
```

> 🚧 Database migrations, first app start and local URLs will be documented here as those tasks land.

### Self-hosting: bring your own developer apps

Each instance uses its own credentials, set through environment variables (see [`infra/.env.example`](infra/.env.example)). The UI never asks for them.

- **X:** an OAuth 2.0 Web App. Callback: `${PUBLIC_BASE_URL}/api/v1/channels/x/callback`.
- **LinkedIn:** an app with _Share on LinkedIn_ and _Sign In with LinkedIn using OpenID Connect_. Redirect: `${PUBLIC_BASE_URL}/api/v1/channels/linkedin/callback`.
- **Telegram (optional):** your own bot for notifications.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md) for private vulnerability reports.

### License

[AGPL-3.0](LICENSE).

### Acknowledgements

[Postiz](https://github.com/gitroomhq/postiz-app) is the product inspiration and an architecture reference. omero-social-post is written from scratch and **does not copy Postiz code**.
