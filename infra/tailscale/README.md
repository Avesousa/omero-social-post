# Exponer omero con Tailscale

omero no tiene puertos públicos. El contenedor `web` publica solo en `127.0.0.1:3000` del servidor y [Tailscale](https://tailscale.com) lo sirve por HTTPS **solo dentro de tu tailnet** (tu red privada de dispositivos). Nada queda abierto a internet.

```
navegador / teléfono (en tu tailnet)
        │  https://omero.<tailnet>.ts.net
        ▼
tailscale serve (HTTPS 443, certificado automático)
        │  http://127.0.0.1:3000
        ▼
contenedor web ──/api/*──► contenedor api (red interna de Docker)
```

## 1. Activar MagicDNS y certificados HTTPS (una sola vez)

En la consola de administración de Tailscale, [DNS](https://login.tailscale.com/admin/dns):

1. **MagicDNS**: activalo. Cada máquina recibe un nombre `<máquina>.<tailnet>.ts.net`.
2. **HTTPS Certificates**: activalo. Así `tailscale serve` puede pedir un certificado de Let's Encrypt para ese nombre.

El nombre de tu tailnet (`tail1234.ts.net` o similar) aparece en esa misma página.

## 2. Conectar el servidor al tailnet

`infra/bootstrap.sh` instala Tailscale. Si le pasaste `TS_AUTHKEY`, el servidor ya está conectado con Tailscale SSH activado. Si no:

```sh
sudo tailscale up --ssh --hostname=omero
```

Abrí la URL que imprime y aprobá la máquina. Con `--hostname=omero` el nombre queda `omero.<tailnet>.ts.net`.

> Las auth keys se generan en [Settings → Keys](https://login.tailscale.com/admin/settings/keys). Para un servidor conviene una key de un solo uso, y desactivar _key expiry_ para esa máquina en la lista de Machines, así no se desconecta a los 180 días.

## 3. Servir la app por HTTPS

Con el stack levantado (`docker compose up -d`):

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

- `--bg` deja la configuración guardada: sobrevive a reinicios del servidor y de `tailscaled`.
- El primer acceso puede tardar unos segundos mientras se emite el certificado.
- Para quitarlo: `sudo tailscale serve --https=443 off` (o `sudo tailscale serve reset`).

## 4. `PUBLIC_BASE_URL`

La URL que muestra `tailscale serve status` es la URL pública de la app **para vos**, por ejemplo:

```
PUBLIC_BASE_URL=https://omero.tail1234.ts.net
```

Ponela en `/opt/omero/.env` sin barra final y reiniciá la API (`docker compose up -d`). Debe coincidir **exactamente** con la URL del navegador. Se usa para los callbacks de OAuth, los links de las notificaciones y el chequeo de `Origin` contra CSRF.

## 5. URLs de callback de OAuth

Registralas en los portales de desarrollador con tu `PUBLIC_BASE_URL`:

| Red      | Dónde                                                                  | URL                                                               |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| X        | developer.x.com → tu app → User authentication settings → Callback URI | `https://omero.tail1234.ts.net/api/v1/channels/x/callback`        |
| LinkedIn | linkedin.com/developers → tu app → Auth → Authorized redirect URLs     | `https://omero.tail1234.ts.net/api/v1/channels/linkedin/callback` |

Funciona aunque el host sea privado: la redirección de OAuth la hace **tu navegador**, que está dentro del tailnet. X y LinkedIn nunca se conectan a tu servidor. El servidor solo hace llamadas salientes a sus APIs.

Si cambiás el nombre de la máquina o el tailnet, actualizá `PUBLIC_BASE_URL` y estas dos URLs.

## 6. Por qué nada es público (sin Funnel)

Tailscale tiene **Funnel**, que publicaría la app en internet. omero no lo usa a propósito:

- La app es de un solo usuario y guarda tokens de OAuth de tus redes. No hay motivo para exponer el login a todo internet.
- Ningún flujo lo necesita: OAuth funciona desde el navegador y no hay webhooks entrantes.
- Docker publica solo en `127.0.0.1`, `ufw` niega todo lo entrante salvo SSH, y el tráfico del tailnet lo controlan las ACL de Tailscale.

## 7. Desde el teléfono

1. Instalá la app de Tailscale (iOS / Android) e iniciá sesión con la misma cuenta del tailnet.
2. Abrí `https://omero.<tailnet>.ts.net` en el navegador del teléfono. Podés agregarla a la pantalla de inicio.
3. La futura app móvil (Expo) va a usar la misma URL. Solo necesita que Tailscale esté conectado en el teléfono.

## Problemas comunes

| Síntoma                                  | Causa probable                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `serve` no consigue certificado          | Falta activar _HTTPS Certificates_ (paso 1).                                                 |
| El nombre `.ts.net` no resuelve          | MagicDNS apagado, o el dispositivo no está conectado al tailnet.                             |
| 502 / página en blanco                   | El contenedor `web` no está sano: `docker compose ps` y `docker compose logs web`.           |
| Login rechazado o loop de login          | `PUBLIC_BASE_URL` no coincide exactamente con la URL del navegador.                          |
| `redirect_uri` inválido al conectar X/LI | La callback registrada en el portal no coincide con `PUBLIC_BASE_URL` + la ruta de la tabla. |

---

## English summary

omero publishes no public ports. The `web` container listens on `127.0.0.1:3000` only, and Tailscale serves it over HTTPS inside your tailnet.

1. In the Tailscale admin console (DNS page), enable **MagicDNS** and **HTTPS Certificates**.
2. Join the server: `bootstrap.sh` with `TS_AUTHKEY`, or `sudo tailscale up --ssh --hostname=omero`. Disable key expiry for the server.
3. Serve the app: `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. The setting persists across reboots; check it with `tailscale serve status`.
4. Set `PUBLIC_BASE_URL=https://<host>.<tailnet>.ts.net` in `/opt/omero/.env` (exact match, no trailing slash), then run `docker compose up -d`.
5. Register the OAuth callbacks:
   - X: `${PUBLIC_BASE_URL}/api/v1/channels/x/callback`
   - LinkedIn: `${PUBLIC_BASE_URL}/api/v1/channels/linkedin/callback`

   OAuth works on a private host because the redirect happens in your browser, and the providers never call the server.

6. **No Funnel:** nothing needs inbound internet access. The app holds your OAuth tokens, so it stays tailnet-only.
7. **Phone:** install the Tailscale app, join the same tailnet and open the same URL. The future Expo app will work the same way.
