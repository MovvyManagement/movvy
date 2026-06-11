# Movvy E2E tests · Maestro

Three happy-path flows that catch ~80% of regressions if you run them before
every release. Maestro drives the actual app — no Detox bridge, no Appium.

## Install

```sh
# macOS / Linux
brew tap mobile-dev-inc/tap
brew install maestro

# Or download the binary directly:
# https://maestro.mobile.dev/getting-started/installing-maestro
```

## Run

Boot your simulator/emulator, install the Movvy dev build (Expo Go or a
custom dev client), then:

```sh
# Run all three flows
maestro test .maestro/

# Or run individually
maestro test .maestro/01_customer_book_flow.yaml
maestro test .maestro/02_driver_accept_and_complete.yaml
maestro test .maestro/03_partner_signin_with_code.yaml
```

## What's covered

| Flow | Validates |
|---|---|
| `01_customer_book_flow` | Welcome → signup → home → quote → confirm → land on Moves tab |
| `02_driver_accept_and_complete` | Driver sign-in → see job → accept → flag stops → complete → rate customer |
| `03_partner_signin_with_code` | Welcome → partner sign-in → enter team code + creds → land on driver app |

## What's NOT covered (yet)

- Push notification delivery (Maestro can observe but not trigger Expo Push)
- Cross-device flows (driver app + customer app at the same time)
- Stripe payments (not wired in v0)
- Realtime subscriptions across two simulators

These need a fuller harness — track in a follow-up.

## CI

Add to your GitHub Actions workflow once you have iOS/Android EAS builds:

```yaml
- uses: mobile-dev-inc/action-maestro-cloud@v1
  with:
    api-key: ${{ secrets.MAESTRO_CLOUD_API_KEY }}
    app-file: ./build/movvy.app
```
