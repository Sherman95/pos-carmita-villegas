# Respaldo previo a Fase 8

Creado antes de modificar código o PostgreSQL local (Fase 8: WhatsApp bidireccional + notificaciones internas POS/SIDRO). La base respaldada fue `poscarmitaVlocal` en localhost (PostgreSQL 18).

## Base de datos

- Archivo: `poscarmitaVlocal_pre_phase8.dump`
- Formato: custom (`pg_dump -F c`)
- Tamaño: 112663 bytes
- SHA-256: `5753B1C36F190335B94E56A2A2651CB889BA887CD88F948BDE025F4612C815E3`

## Archivos

Cada copia utiliza la ruta original con separadores sustituidos por `__` y prefijo del repositorio (`pos-backend`, `pos-frontend`, `sidro`).

| Copia | SHA-256 |
|---|---|
| `pos-backend__package.json` | `5F1CF01EF26C9E0455F53A8D7DFB859AD62F9BA2BDEC518A1741C6589402B384` |
| `pos-backend__src__index.ts` | `1786541CC2159EF8AE84FAA4CD86D2B407C24B648CA874B358F2E8FD34DF5C62` |
| `pos-backend__src__routes__adminSidro.routes.ts` | `BE41D57A812DD08F51713AC2F4598E24844D076EF5657F73FB3F99930ADE88E2` |
| `pos-backend__src__routes__sidro.routes.ts` | `56EDDE923131F1AB1EE7172F63DC4AF77A7A67E749C677319E3200F165BC7332` |
| `pos-backend__src__routes__businessSettings.routes.ts` | `403F590A2EC0BDCB5644A68E0F7D0A1C34E39C63814775CDF2313A527A4F67D8` |
| `pos-backend__src__controllers__adminSidro.controller.ts` | `69ED2B518C78CBA2D80BF453252903F75A74ED31247286059AB35744FED4F15F` |
| `pos-backend__src__controllers__sidroAppointments.controller.ts` | `928AAC093EA95FB6529FCC33EDCF0B26D49F20C16F9A82DD1A1E9B74A546A988` |
| `pos-backend__src__controllers__appointments.controller.ts` | `C96FE6A38E5A0C28E949CE82FFEFF4E199EC12B0DEA7276571522B70C63D5B39` |
| `pos-backend__src__controllers__businessSettings.controller.ts` | `79320913BC886648999E242C704A4A3839EAF6C6B61F482207062AAD1D3C3F9C` |
| `pos-frontend__src__app__components__sidro-requests__sidro-requests.component.ts` | `066CE7BE0578E2E800A819924A795D88F0585ABF31CA33C0D7069F1A4D40936B` |
| `pos-frontend__src__app__components__sidro-requests__sidro-requests.component.html` | `A0CD22D2944A3B695C1BC6EDAE654134D4C7AA984DA38C0306BAED758B0EB4C7` |
| `pos-frontend__src__app__components__sidro-requests__sidro-requests.component.scss` | `0B4AD6324BDC84DD5F739D6797C66248933B339B50B9CE9D49436712965C3F3E` |
| `pos-frontend__src__app__services__sidro-admin.service.ts` | `A84FFD48F38E8C6BD91659950E678A566AD39C581CAEFD20EFAD0C71D3D6BEB1` |
| `pos-frontend__src__app__components__settings__settings.ts` | `808472F9AF32D841832AF9124E29BEAD39F41B7BB214FBAB8641CD26F01E75CE` |
| `pos-frontend__src__app__components__settings__settings.html` | `9F583809E042F62307C51E9E0ED5108D8145D938DEB18B7B4EA8A9190C95907A` |
| `pos-frontend__src__app__components__settings__settings.scss` | `D514D6A502F09B287C6AD9D5CA09828ADE5EF251207C5AC59D280F495E0D3119` |
| `pos-frontend__src__app__components__sidenav__sidenav.ts` | `41ACC49DFED09A35C4C68093057DFA016DBA789AA4AC2B398401F7D22906A788` |
| `pos-frontend__src__app__components__sidenav__sidenav.html` | `4ED3EDA6C5C30FD64054A15EEA33682BF6C29456C40AE119DD76CB2C4803A9CD` |
| `pos-frontend__src__app__components__sidenav__sidenav.scss` | `BD001FFCB2D88E321AEAE2F7ECD3D4A6650966BBAC172DAB0799A129F524A13E` |
| `sidro__src__app__services__booking.service.ts` | `75AB9D95F63024AD99EF8E45B2AAB38E9C8757B62A09B26495AC8C0A15089827` |
| `sidro__src__app__components__my-requests__my-requests.component.ts` | `A8B4E303FC507973880BCC9D300A50B48734A2E0AD69FDD0794D659866FC3CEA` |
| `sidro__src__app__components__my-requests__my-requests.view.html` | `5D8603D3FEA81DF4320A4DD00C4E574BDDAC28102D4C174BAB75B20D094E028C` |
| `sidro__src__app__components__mobile-nav__mobile-nav.component.html` | `AD5E4A1DD4C21C4DB52FF2F1D5F3B7941DC7469C14B5BDCBF6FE39FB593A479A` |

| `sidro__src__app__components__my-requests__my-requests.view.scss` | `A7EE30E286E15FFB3BEADEF09D5E9204B722C137E545A158343123E97EED84AB` |
| `sidro__src__app__components__my-requests__my-requests.luxury-extension.scss` | `BC815139FB3B3C4BD5FF8576DCCD57CC3F3CE38DB9A8CF03F72368EDF587E8E2` |
| `sidro__src__app__components__dashboard__dashboard.component.ts` | `BACBFADC6ED2DF64D6AA7C26142DF3CD6847DB42B50B138F88B80F52A5CCAC81` |
| `sidro__src__app__components__dashboard__dashboard.component.html` | `074DB96653672AA2AD1025462255AD0654B2E93D9D20AEC74D50F9B998C78E84` |
| `sidro__src__app__components__dashboard__dashboard.luxury.html` | `EC87D85A2A073CCF51A15C14F0EAF54A9CB532607DDC409F043274851AA7D80C` |
| `sidro__src__app__services__auth.service.ts` | `EF6DB637848D12D491730C98CAA8ACB77BF482E97F23C1DF1CF6A065FF4137E4` |
| `sidro__src__app__app.routes.ts` | `475C85940B6A52F54F162826F48963DD12C13299CE27D41B61388013B3818C9C` |
| `sidro__src__app__components__profile__profile.component.ts` | `3BAE386A1B493C9721B620D46521C4C2B7C2E40906712EBBA13F3A8900EABFA5` |
| `sidro__src__app__components__profile__profile.component.html` | `3B25EB8320C17584CBF45C5A70B134F897C7CF71C2B027DA42D406450327B90C` |

Nota: las copias cubren el conjunto inicial identificado; si alguna etapa requiere modificar archivos adicionales, se agregarán copias y hashes a este manifiesto antes de editarlos.

## Verificación rápida (PowerShell)

```powershell
Get-FileHash "D:\Documents\pos-carmita-villegas\backend\.phase8-backup\pre_changes_20261018\poscarmitaVlocal_pre_phase8.dump" -Algorithm SHA256
```
