# PATCH-NOTES — fork local

Base: [zxzxn3/deepseek-status-bar-for-copilot](https://github.com/zxzxn3/deepseek-status-bar-for-copilot) (MIT).
Este fork agrega el semáforo de tarifa pico/valle y corrige la tabla de precios.

## Cambios respecto al upstream

### 1. `src/pricing.ts` — tarifa de Flash corregida

La tabla traía `{cache_hit: 0.05, cache_miss: 1.5, output: 4.5}` CNY, que es la tarifa
**anterior al 10-sep-2026**. Ahora usa la vigente (`0.02 / 1 / 4` CNY off-peak).
El README del upstream ya documentaba la tarifa nueva, pero la constante no se había
actualizado — todos los cálculos de costo de Flash estaban ~2.5× altos.

### 2. `src/pricing.ts` — pico/valle basado en UTC

Antes: `isPeakBeijing()` calculaba la hora de Beijing (`dayjs.utc(ts).add(8, "hour")`)
para decidir si era pico. El *resultado* era correcto, pero el código quedaba acoplado
a la zona de Beijing.

Ahora hay una única fuente de verdad en UTC, tal como la define la documentación
oficial (01:00–04:00 y 06:00–10:00 UTC, lunes a viernes; el resto, incluido el fin de
semana completo, es valle). El resultado no cambia, pero deja de depender de un offset
hardcodeado.

Nuevas funciones:

| Función | Devuelve |
|---|---|
| `peakStateAt(ts?)` | `{ peak, remainMs }` — estado actual y ms hasta el próximo cambio |
| `peakWindowsLocal()` | Las dos ventanas de pico en la zona horaria de la máquina |

`isPeakBeijing()` sigue exportada (mismo nombre y firma) porque la usan
`stats.ts`, `detailPanel.ts`, `termfmt.ts` y `extension.ts`.

### 3. `src/extension.ts` — semáforo y countdown

La barra de estado ahora se ve así, en cualquiera de los 6 formatos:

```
💚 2h14m  $(credit-card) $0.0031/0.0012  1.20M/0.90M
⚡ 0h45m  $(credit-card) $0.0031/0.0012  1.20M/0.90M
```

- `💚` valle, `⚡` pico
- El número es el tiempo hasta el próximo cambio de tramo
- El tooltip muestra el tramo actual y las ventanas de pico **en tu hora local**

El countdown se refresca con el mismo polling que el resto (`pollIntervalSeconds`,
10 s por defecto).

### 4. `src/i18n.ts` — 6 cadenas nuevas

`peakNow`, `offPeakNow`, `peakIn`, `offPeakIn`, `peakWindows`, `localTime` (en / zh-cn).

### 5. `test.ts` — aserciones actualizadas + 9 pruebas nuevas

Las aserciones de costo de Flash usaban la tarifa vieja. Se actualizaron y se agregaron
pruebas del countdown (bordes de ventana, salto de fin de semana).

## Verificado

```
npm run typecheck   # limpio
npm test            # ALL PASS
npm run smoke       # todos OK (proxy SSE, agregación, 402, streaming)
```

Ventanas de pico comprobadas contra la zona `America/Santiago` (UTC−3 en septiembre):

```
peak win  : 22:00–01:00  |  03:00–07:00
Sun 12:00Z OFF -> 780 min   (lunes 01:00Z)
Mon 02:00Z PEAK -> 120 min  (lunes 04:00Z)
Mon 07:30Z PEAK -> 150 min  (lunes 10:00Z)
```

## Pendiente (no implementado a propósito)

- **El "hoy" sigue cortándose a medianoche de Beijing.** La etiqueta del tooltip lo dice
  ("Today (Beijing time)"), y coincide con el día contable de DeepSeek — pero para
  alguien en UTC−3 significa que su jornada se parte entre dos días. Cambiarlo toca
  `stats.ts`, `chartData.ts` y `detailPanel.ts`, y rompe las expectativas de los tests
  existentes.
- **Precios por fecha.** El README del upstream afirma que los registros históricos se
  tarifan con el precio de su momento, pero la tabla es plana: todo el historial se
  recalcula con el precio actual. Implementarlo requiere una tabla con épocas.
- **Interfaz en español.** `src/i18n.ts` solo tiene `en` y `zh-cn`.
