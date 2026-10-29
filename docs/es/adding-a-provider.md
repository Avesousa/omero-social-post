# Cómo agregar una red social

Cada red es un adaptador que implementa la interfaz `SocialProvider`. Agregar una red no toca los módulos de dominio (posts, scheduling, calendario): toca un conjunto acotado de archivos, listados abajo. Como referencia, mirá los adaptadores existentes: [`x/x.provider.ts`](../../apps/api/src/providers/x/x.provider.ts) y [`linkedin/linkedin.provider.ts`](../../apps/api/src/providers/linkedin/linkedin.provider.ts). Versión en inglés: [adding-a-provider.md](../en/adding-a-provider.md).

## Reglas

- **Solo APIs oficiales.** Nada de scraping ni endpoints no documentados.
- **Documentación oficial primero.** Copiá las URLs de la documentación que usaste en el encabezado del adaptador, con la fecha de verificación, igual que hacen X y LinkedIn.
- **Los secretos vienen de variables de entorno.** Nunca los hardcodees, y que no aparezcan en los mensajes de error ni en los logs.

## Mapa de archivos

| Archivo                                                              | Qué cambia                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/providers.ts`                                   | Agregar el id a `PROVIDER_IDS` y una entrada en `PROVIDER_LIMITS`. Sin la entrada, `Record<ProviderId, ProviderLimits>` no compila. |
| `packages/shared/test/*.test.ts`                                     | Casos de validación para los nuevos límites (por ejemplo, `validate.test.ts`).                                                      |
| `apps/api/src/config/env.schema.ts`                                  | Variables de credenciales y su par en la lista de `superRefine`.                                                                    |
| `apps/api/src/providers/provider.registry.ts`                        | Entrada en `PROVIDER_ENV` y el `register(...)` en el constructor.                                                                   |
| `apps/api/src/providers/<id>/`                                       | `<id>.constants.ts`, `<id>.provider.ts` y `<id>.provider.test.ts`.                                                                  |
| `apps/api/src/db/schema/enums.ts`                                    | Agregar el id a `PROVIDERS`, y generar la migración.                                                                                |
| `apps/api/test/msw/handlers/<id>.ts` y `apps/api/test/msw/server.ts` | Fixtures de msw y registro en `setupServer`.                                                                                        |
| `apps/api/test/integration/providers.int.test.ts`                    | La lista esperada de `GET /providers`, si cambia.                                                                                   |
| `apps/api/openapi.json` y `packages/api-client`                      | Regenerados con `pnpm generate`.                                                                                                    |
| `docs/es/self-hosting.md`, `docs/es/configuration.md`                | Pasos para crear la app y variables nuevas.                                                                                         |

## 1. Límites compartidos

`packages/shared/src/providers.ts` define `PROVIDER_LIMITS`, que usan el composer y la validación de la API (`validatePostInput` en `packages/shared/src/text/validate.ts`):

```ts
export const PROVIDER_IDS = ['x', 'linkedin', '<id>'] as const;

// PROVIDER_LIMITS: Readonly<Record<ProviderId, ProviderLimits>>
<id>: {
  maxChars: 1000,
  weightedCounting: false,
  maxImagesPerItem: 4,
  maxImageBytes: 5 * MB,
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  supportsThreads: false,
},
```

Campos de `ProviderLimits` (`providerLimitsSchema`):

- `maxChars` y `longPostMaxChars` (opcional, para cuentas con `longPostsEnabled`).
- `weightedCounting`: `true` solo si la red usa un conteo ponderado, como X.
- `maxImagesPerItem`, `maxImageBytes` y `allowedMimeTypes`.
- `supportsThreads`: `true` si una entrega puede tener varios ítems. Si es `false`, la entrega tiene exactamente un ítem.

Documentá el origen de cada límite en un comentario, con la URL oficial. Si la red no documenta un valor, decilo en el comentario, como hace LinkedIn con su límite de bytes.

## 2. Variables de entorno

En `apps/api/src/config/env.schema.ts`, agregá las variables al objeto `envSchema` como opcionales y sumá el par a la lista de `superRefine`, para que ambas estén o ninguna:

```ts
<ID>_CLIENT_ID: optionalString,
<ID>_CLIENT_SECRET: optionalString,
```

Agregalas también a [`infra/.env.example`](../../infra/.env.example) y a [`apps/api/.env.example`](../../apps/api/.env.example), y a la [referencia de configuración](configuration.md).

## 3. El adaptador

Creá `apps/api/src/providers/<id>/<id>.provider.ts` con una clase que implemente `SocialProvider` ([`provider.types.ts`](../../apps/api/src/providers/provider.types.ts)):

- `id`, `limits` (de `PROVIDER_LIMITS`) y `scopes`.
- `getAuthorizationUrl(state, pkce)`: URL de consentimiento. Recibe el `state` y el PKCE ya generados.
- `exchangeCode(code, pkce)` y `refresh(tokens)`: devuelven un `TokenSet`. Si el refresh es imposible, lanzá `ReauthRequired`.
- `getProfile(tokens)`: devuelve un `ChannelProfile` (`externalId`, `handle`, `displayName`, `avatarUrl`).
- `uploadMedia(ctx, file)` y `publishItem(ctx, item, replyTo?)`: reciben un `ProviderContext`, que trae los tokens y la cuenta. `item.media` puede tener archivos crudos o refs ya subidas: usá `isRemoteMediaRef` para distinguirlos.
- `classifyError(err)`: devolvé `classifyProviderError(err)`, como hacen los adaptadores existentes.
- `fetchMetrics(ctx, refs)`: opcional, solo si la red permite leer métricas con el token del dueño.

### Manejo de errores

Mapeá cada respuesta de error a una clase de [`provider-errors.ts`](../../apps/api/src/providers/provider-errors.ts):

| Caso                                                 | Clase                                            | Efecto                             |
| ---------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| 429, 5xx, red o timeout                              | `RetryableProviderError` (acepta `retryAfterMs`) | Se reintenta.                      |
| Token rechazado (401), o refresh rechazado           | `ReauthRequired`                                 | El canal pasa a `needs_reconnect`. |
| Contenido rechazado, duplicado, permisos, validación | `PermanentProviderError`                         | La entrega falla sin reintento.    |

Seguí el patrón de `errorFromResponse` de los adaptadores existentes: un método que lee el cuerpo con `readJson`, arma un `code` estable (por ejemplo `DUPLICATE_CONTENT`) y un mensaje sin tokens. Recortá el detalle de la red con `truncateDetail`.

### Helpers

De [`provider-http.ts`](../../apps/api/src/providers/provider-http.ts):

- `providerFetch(provider, url, init)`: `fetch` con timeout de `PROVIDER_TIMEOUT_MS` (15 s). Los errores de red y los timeouts salen como `RetryableProviderError`.
- `readJson`, `retryAfterHeaderMs`, `basicAuth` (para clientes confidenciales), `parseScopes` (acepta espacios y comas) y `expiryFromSeconds`.

Para PKCE, `pkceFromVerifier` de [`oauth-state.store.ts`](../../apps/api/src/providers/oauth-state.store.ts) calcula el par S256.

Las constantes (URLs base, scopes, versiones de API) van en `<id>.constants.ts`, como en X y LinkedIn.

## 4. Registro

En [`provider.registry.ts`](../../apps/api/src/providers/provider.registry.ts):

1. Agregá el par de variables en `PROVIDER_ENV`. Lo usa `GET /providers` para indicar qué falta.
2. En el constructor de `ProviderRegistry`, registrá el adaptador solo si sus dos variables están presentes:

```ts
if (env.<ID>_CLIENT_ID && env.<ID>_CLIENT_SECRET) {
  this.register(
    new <Name>Provider({
      clientId: env.<ID>_CLIENT_ID,
      clientSecret: env.<ID>_CLIENT_SECRET,
      redirectUri: oauthRedirectUri(env.PUBLIC_BASE_URL, '<id>'),
    }),
  );
}
```

`oauthRedirectUri` arma `${PUBLIC_BASE_URL}/api/v1/channels/<id>/callback`, la URL que el dueño registra en el portal de la red.

Sin credenciales, la red queda como `configured: false` y no se puede conectar. Eso es lo que se espera en una instancia que no la configuró.

## 5. Base de datos

`PROVIDERS` en [`apps/api/src/db/schema/enums.ts`](../../apps/api/src/db/schema/enums.ts) define el enum `provider` de Postgres. Agregá el id y generá la migración:

```sh
pnpm --filter @omero/api db:generate
```

Las migraciones se aplican al arrancar la API, antes de que Nest inicie, y solo avanzan. Revisá el SQL generado en `apps/api/drizzle/` antes de commitearlo.

## 6. Tests

Los tests no pueden salir a la red real. En `apps/api/test/msw/server.ts`, cualquier request externa sin handler falla (`onUnhandledFrame`).

1. **Fixtures.** Creá `apps/api/test/msw/handlers/<id>.ts`, con respuestas que tengan la forma real de la API (como `X_FIXTURES` en `handlers/x.ts`) y un array de handlers por defecto (`xHandlers`, `linkedinHandlers`).
2. **Registro.** Sumá el array en `setupServer(...)` de `apps/api/test/msw/server.ts`.
3. **Tests unitarios.** En `apps/api/src/providers/<id>/<id>.provider.test.ts`, probá:
   - la URL de autorización (state, PKCE y scopes);
   - el intercambio de código y el refresh;
   - publicar un ítem y un hilo, si la red lo soporta, con el orden y los ids de respuesta correctos;
   - cada caso de error del cuadro de la sección 3 (429, 5xx, 401, 403, duplicado, timeout).

   Usá `server.use(http.post(...))` para casos puntuales. Mirá `x.provider.test.ts` como ejemplo.

4. **Integración.** Si cambió la lista de redes, actualizá `apps/api/test/integration/providers.int.test.ts`.
5. **Límites.** En `packages/shared/test/`, probá que `validatePostInput` respeta `maxChars`, las imágenes y los tipos MIME de la red nueva.

Para correr la API de tests necesitás Docker (Testcontainers), o `pnpm infra:up` con Postgres y Redis locales. `TEST_DATABASE_URL` y `TEST_REDIS_URL` tienen prioridad si están definidas.

## 7. Verificación

Corré lo mismo que CI, desde la raíz del repo:

```sh
pnpm generate        # shared, openapi.json y api-client
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Después, actualizá la [guía de self-hosting](self-hosting.md) con los pasos para crear la app en el portal de la red, y el [README](../../README.md) si la lista de redes cambia.

Por confirmar: si la interfaz (`apps/web`) necesita cambios para la nueva red, además de los que trae `GET /providers`.
