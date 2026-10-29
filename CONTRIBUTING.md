# Cómo contribuir

¡Gracias por querer sumar a **omero-social-post**! Esta guía explica cómo proponer cambios. _(English summary at the end.)_

Al participar aceptás el [Código de Conducta](CODE_OF_CONDUCT.md). Las vulnerabilidades de seguridad **no** se reportan en issues públicas: seguí [SECURITY.md](SECURITY.md).

## Idiomas

- **Conversación** (issues, PRs, discusiones): español o inglés, lo que te resulte más cómodo.
- **Specs, código y comentarios en el código:** inglés.
- **Interfaz:** español primero; todo texto visible pasa por i18n.

## Cómo proponer un cambio

1. **Abrí una issue primero** para cualquier cambio que no sea trivial (bug, feature, refactor). Así acordamos el enfoque antes de que inviertas tiempo.
2. Hacé un fork y creá una rama desde `main` (ver [nombres de ramas](#nombres-de-ramas)).
3. Para features y cambios de comportamiento, seguí el [flujo SDD](#flujo-spec-driven-development).
4. Antes de abrir el PR, corré los [checks locales](#checks-locales).
5. Abrí el PR contra `main`, enlazá la issue y contá qué cambia y cómo lo probaste. CI tiene que quedar en verde.

PRs chicos y enfocados se revisan mucho más rápido que uno grande que toca todo.

## Flujo Spec Driven Development

El proyecto se construye con **Spec Driven Development (SDD)**. Cada ciclo vive en `AiBuild/<tipo>/<nombre>/`:

| Paso              | Archivo                  | Qué contiene                                                                           |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| 1. Spec funcional | `WIP/functional-spec.md` | Qué y por qué: flujos, casos borde, criterios de aceptación, fuera de alcance          |
| 2. Spec técnica   | `WIP/technical-spec.md`  | Cómo: arquitectura, modelo de datos, contratos, dependencias, seguridad, plan de tests |
| 3. Plan           | `WIP/plan.md`            | Tareas atómicas (`T001`, `T002`, …) con dependencias y criterio de "listo"             |
| 4. Build          | código + `WIP/meta.json` | Implementación tarea por tarea; `meta.json` registra el progreso                       |
| 5. Cierre         | carpeta archivada        | Se verifica todo, se archivan las specs y se limpia `WIP/`                             |

En la práctica:

- **Bugs chicos y docs:** issue + PR alcanzan.
- **Features o cambios de comportamiento:** proponé (o actualizá) la spec funcional en el PR o en la issue antes del código. Si el cambio cae dentro de un ciclo en curso, referenciá la tarea del plan (por ejemplo `T021`).
- **Decisiones técnicas nuevas** (dependencias, cambios de esquema, nuevas redes) se documentan en la spec técnica con su porqué y las alternativas descartadas.

## Nombres de ramas

`<tipo>/<descripcion-corta-en-kebab-case>`:

| Prefijo    | Uso                                             |
| ---------- | ----------------------------------------------- |
| `feature/` | Funcionalidad nueva (`feature/bluesky-adapter`) |
| `fix/`     | Corrección de bug (`fix/queue-slot-dst`)        |
| `mvp/`     | Ciclo MVP de una etapa (`mvp/core-publishing`)  |
| `hotfix/`  | Corrección urgente sobre `main`                 |
| `poc/`     | Prueba de concepto, puede no mergearse          |
| `docs/`    | Solo documentación                              |
| `chore/`   | Mantenimiento, tooling, dependencias            |

CI corre en todos los pull requests y en los pushes a `main`, `mvp/**`, `feature/**` y `fix/**`.

## Commits: Conventional Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/):

```
<tipo>(<scope opcional>): <descripción en imperativo>

<cuerpo opcional: el porqué del cambio>

<footer opcional: BREAKING CHANGE, Refs #123>
```

- **Tipos:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes habituales:** `api`, `web`, `shared`, `infra`, `ci`, `deps`, `sdd`.
- **Ejemplos:**
  - `feat(api): add LinkedIn provider adapter`
  - `fix(web): keep calendar week view in owner timezone`
  - `docs(sdd): technical spec for feature/news-digest`

## Entorno de desarrollo

Necesitás:

- Node.js 22 (ver [`.nvmrc`](.nvmrc));
- pnpm 10 (`corepack enable`);
- Docker con Compose;
- gitleaks.

```bash
pnpm install                       # instala dependencias y los git hooks (lefthook)
cp infra/.env.example infra/.env
pnpm infra:up                      # Postgres + Redis locales
pnpm dev
```

### Git hooks (lefthook + gitleaks)

`pnpm install` instala los hooks de [lefthook](https://lefthook.dev) definidos en [`lefthook.yml`](lefthook.yml). El pre-commit:

- corre **gitleaks** sobre los cambios en stage para frenar secretos;
- corre **`prettier --check`** sobre los archivos en stage.

Si gitleaks no está instalado, el hook muestra una advertencia y deja pasar el commit, pero **instalalo**: CI lo corre igual y un PR con secretos va a fallar.

Formas de instalar gitleaks:

```bash
brew install gitleaks                                   # macOS / Linux con Homebrew
go install github.com/zricethezav/gitleaks/v8@latest    # con Go instalado
# o descargá el binario de https://github.com/gitleaks/gitleaks/releases y ponelo en tu PATH
```

Para reinstalar los hooks: `pnpm exec lefthook install`.

## Checks locales

Son los mismos que corre CI:

```bash
pnpm format:check   # o `pnpm format` para corregir
pnpm lint
pnpm typecheck
pnpm test           # tests de integración necesitan Docker (Testcontainers) o `pnpm infra:up`
pnpm build
```

Los caminos críticos (scheduler, reintentos, hilos, tokens OAuth, cola de slots, seguridad) **tienen que** venir con tests. Ver el plan de tests en la spec técnica.

## Secretos: nunca en el repo

- **Toda la configuración entra por variables de entorno.** No hay valores del dueño de una instancia en el código.
- **Nunca commitees** archivos `.env`, tokens, client secrets, claves privadas ni dumps de base de datos. `.env` y `.env.*` están en `.gitignore`; solo se versiona `infra/.env.example`, con placeholders.
- **Si agregás una variable nueva,** documentala en [`infra/.env.example`](infra/.env.example) con un comentario (para qué sirve, si es opcional, cómo obtenerla).
- **En tests,** generá valores descartables en runtime (por ejemplo `openssl rand -base64 32`), no los pegues en el código.
- **Si se te escapa un secreto en un commit,** aunque lo borres en el siguiente, **rotalo de inmediato** en el proveedor (X, LinkedIn, Telegram…): el historial de git lo conserva.
- **Si gitleaks marca un falso positivo,** agregá una regla acotada en [`.gitleaks.toml`](.gitleaks.toml) y explicala en el PR. No desactives el hook con `--no-verify`.

## Reglas del proyecto

- **Solo APIs oficiales** de cada red: nada de scraping ni endpoints no oficiales.
- **Presupuesto de recursos:** todo tiene que correr cómodo en 1 vCPU / 4 GB junto con Postgres y Redis. Evitá dependencias pesadas y justificá las nuevas.
- **Postiz** es solo referencia de producto y arquitectura: no copies su código.
- Al contribuir aceptás que tu aporte se publique bajo la licencia [AGPL-3.0](LICENSE) del proyecto.

---

## English summary

- Open an issue before non-trivial changes. Branch from `main` using `feature/`, `fix/`, `mvp/`, `hotfix/`, `poc/`, `docs/` or `chore/`.
- Features follow the Spec Driven Development flow in `AiBuild/<type>/<name>/`: functional spec → technical spec → plan → build → finish.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(api): …`, `fix(web): …`).
- Before opening a PR, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
- `pnpm install` sets up lefthook pre-commit hooks (gitleaks + prettier). Install [gitleaks](https://github.com/gitleaks/gitleaks#installing) locally.
- **Never commit secrets.** Configuration comes from environment variables, documented in `infra/.env.example`. If a secret leaks, rotate it immediately.
- Specs and code are written in English; discussions can be in Spanish or English.
- Contributions are licensed under AGPL-3.0.
