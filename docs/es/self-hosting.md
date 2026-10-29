# Self-hosting: de cero a un canal de X conectado

> **Estado:** la etapa 1 (`mvp/core-publishing`) está en construcción. Esta guía describe el flujo previsto. Los pasos marcados _(por confirmar)_ se verifican en la prueba de punta a punta del dueño (T040). Versión en inglés: [self-hosting.md](../en/self-hosting.md).

Esta guía lleva a una instancia propia de omero-social-post desde un VPS vacío hasta un canal de X conectado. Seguí los pasos en orden.

## 1. Requisitos

- Un VPS con **Ubuntu 24.04** (objetivo: 1 vCPU / 4 GB) y acceso SSH con tu clave pública. Si el VPS es de Hostinger con Traefik preinstalado, seguí primero la sección 0 de [infra/README.md](../../infra/README.md).
- Una cuenta de **Tailscale** y al menos un dispositivo desde el que abrir la app.
- Una app de desarrollador de **X** en [developer.x.com](https://developer.x.com), con créditos cargados. La API de X es pay-per-use.
- Una cuenta de **LinkedIn** con una **Company Page** asociada a la app. Si no tenés una, creá una mínima.
- Opcional: una cuenta de Telegram para las notificaciones.

No hace falta instalar Docker ni Node en el VPS. `bootstrap.sh` instala Docker y Tailscale, y las imágenes se descargan de GHCR. El VPS nunca compila nada.

## 2. VPS y bootstrap

Seguí [infra/README.md](../../infra/README.md) hasta la sección 2: `bootstrap.sh` y los archivos en `/opt/omero`. No repetimos esos pasos acá. El `.env` se completa en el paso 7 de esta guía.

## 3. Tailscale

1. En la [página DNS de Tailscale](https://login.tailscale.com/admin/dns), activá **MagicDNS** y **HTTPS Certificates**.
2. Conectá el servidor al tailnet con `bootstrap.sh` y `TS_AUTHKEY`, o con `sudo tailscale up --ssh --hostname=omero`. Para ese servidor, desactivá _key expiry_.
3. Tu URL va a ser `https://omero.<tailnet>.ts.net`. El `<tailnet>` aparece en esa misma página. La confirmás al final con `tailscale serve status`.

Nada queda público: no uses Funnel. La redirección de OAuth la hace tu navegador, que está dentro del tailnet. Detalles en [infra/tailscale/README.md](../../infra/tailscale/README.md).

## 4. App de X

1. En el [X Developer Portal](https://developer.x.com), creá una app.
2. Activá **OAuth 2.0** con tipo **Web App / Confidential client** y permisos **Read and Write**.
3. En _User authentication settings_, registrá el Callback URI:
   `https://omero.<tailnet>.ts.net/api/v1/channels/x/callback`
4. Cargá créditos. Costos aproximados: $0.015 por post, $0.20 por post que contiene un link y $0.005 por lectura. El composer avisa cuando un post de X lleva un link, porque cuesta más.
5. Copiá el Client ID y el Client Secret a `X_CLIENT_ID` y `X_CLIENT_SECRET`.

La app pide estos scopes: `tweet.read tweet.write users.read media.write offline.access`.

## 5. App de LinkedIn

1. Asociá la app a una Company Page. Si hace falta, creá una mínima.
2. En [LinkedIn Developers](https://www.linkedin.com/developers), creá la app.
3. En _Products_, agregá **Sign In with LinkedIn using OpenID Connect** y **Share on LinkedIn**.
4. En _Auth_ → _Authorized redirect URLs_, registrá: `https://omero.<tailnet>.ts.net/api/v1/channels/linkedin/callback`
5. Copiá el Client ID y el Client Secret a `LINKEDIN_CLIENT_ID` y `LINKEDIN_CLIENT_SECRET`.

La app pide los scopes `openid profile w_member_social`. Los tokens de LinkedIn duran unos 60 días y las apps self-serve no reciben refresh token. Vas a tener que reconectar cada ~60 días (ver [solución de problemas](#9-solución-de-problemas)).

## 6. Bot de Telegram (opcional)

1. Creá un bot con @BotFather. Guardá el token en `TELEGRAM_BOT_TOKEN`.
2. Mandale un mensaje al bot.
3. Obtené tu chat id con @userinfobot, o abriendo `https://api.telegram.org/bot<token>/getUpdates` en el navegador. Guardalo en `TELEGRAM_CHAT_ID`. Esa URL contiene el token: no la compartas.

Sin estas dos variables, las notificaciones quedan solo dentro de la app.

## 7. Completar el `.env`

Editá `/opt/omero/.env`, que ya copiaste en la sección 2:

```sh
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 24      # POSTGRES_PASSWORD, y la misma en DATABASE_URL
```

- `ENCRYPTION_KEY` cifra los tokens de OAuth. Guardala fuera del servidor (en un gestor de contraseñas). Si se pierde, hay que reconectar todos los canales.
- `PUBLIC_BASE_URL=https://omero.<tailnet>.ts.net`, sin barra final y idéntica a la URL que usa el navegador.
- `X_CLIENT_ID` y `X_CLIENT_SECRET`, o `LINKEDIN_CLIENT_ID` y `LINKEDIN_CLIENT_SECRET`. Cada par se completa entero. Si falta la mitad de un par, la API no arranca.
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`, opcionales y también de a pares.
- `chmod 600 /opt/omero/.env`.

Cada variable está descrita en [configuration.md](configuration.md).

## 8. Primer arranque, dueño y canales

1. Desde `/opt/omero`, corré `docker compose pull && docker compose up -d`. Si las imágenes de GHCR siguen privadas, iniciá sesión antes (ver el paso 3 de [infra/README.md](../../infra/README.md)).
2. Esperá a que los cuatro servicios estén `healthy` con `docker compose ps`. La API aplica las migraciones al arrancar.
3. Publicá la app en tu tailnet con `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. Confirmá la URL con `tailscale serve status`: tiene que coincidir con `PUBLIC_BASE_URL`. Si la cambiaste, corré `docker compose up -d` otra vez.
4. Desde un dispositivo de tu tailnet, abrí `https://omero.<tailnet>.ts.net`. La app te lleva a `/setup`, donde creás el usuario dueño. Es el único usuario.
5. Entrá a **Ajustes → Canales** y conectá X. Si el botón está deshabilitado, la pantalla te indica qué variable falta.
6. Si configuraste LinkedIn, conectalo de la misma forma. _(por confirmar: verificación del canal conectado en la app)_

### Actualizaciones y backups

[infra/README.md](../../infra/README.md) describe el backup diario con `backup.sh`, la actualización con `OMERO_VERSION` y la restauración. Corré `./backup.sh` antes de cada actualización, y guardá `ENCRYPTION_KEY` fuera del servidor.

## 9. Solución de problemas

### Callback URL no coincide (`redirect_uri` inválido)

- **Causa:** `PUBLIC_BASE_URL`, la URL del navegador y las callbacks registradas en el portal no son idénticas. Fijate en la barra final y en si cambiaste el nombre de la máquina o del tailnet.
- **Arreglo:** la callback tiene que ser exactamente `${PUBLIC_BASE_URL}/api/v1/channels/x/callback` (o `.../linkedin/callback`). Corregí el portal o el `.env`, y después corré `docker compose up -d`.
- Si `PUBLIC_BASE_URL` no coincide con el navegador, el login entra en loop y las acciones que modifican datos responden 403 por el chequeo de `Origin`.

### El canal aparece como "needs reconnect"

- **Causa:** el token fue rechazado (401) o no se pudo renovar. El canal pasa a `needs_reconnect` y la app te avisa, dentro de la app y por Telegram si lo configuraste.
- **Arreglo:** en **Ajustes → Canales**, reconectá el canal. Después reintentá las entregas que fallaron _(por confirmar en la UI)_.

### X: créditos agotados

- **Síntoma:** una entrega falla con `X_USAGE_CAPPED` o `X_CREDITS_DEPLETED`.
- **Causa:** se acabó el saldo de la API pay-per-use. Estos errores no se reintentan solos.
- **Arreglo:** cargá créditos en la X Developer Console y reintentá la entrega a mano.

### LinkedIn: reconexión cada ~60 días

- **Causa:** el token de LinkedIn dura unos 60 días y las apps self-serve no reciben refresh token.
- **Aviso:** la app te avisa 7 días antes del vencimiento.
- **Arreglo:** cuando vence, el canal pasa a `needs_reconnect`. Reconectalo desde **Ajustes → Canales**.

### Otros problemas

La tabla de solución de problemas de [infra/README.md](../../infra/README.md) cubre servicios que no quedan `healthy`, `password authentication failed`, imágenes privadas de GHCR, disco lleno y contenedores que se reinician solos.
