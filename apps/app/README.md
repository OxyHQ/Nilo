# Nilo App

Expo client for the Nilo workspace on web, iOS, and Android.

## Development

```bash
cp .env.example .env
bun start
bun run web
bun run ios
bun run android
```

`EXPO_PUBLIC_API_URL` is required and must name an HTTPS API origin for an
export. Local development may use an explicit HTTP origin.
There is no checked-in production fallback because no public Nilo API is
currently deployed.

Development bundles use Noxcturnal, Expo's oxc transformer
(`experiments.noxcturnalTransformWorker` in `app.config.js`). It runs only when
the Babel config is the bare Expo preset and Metro has no custom Babel
transformer, so `babel.config.js` is the one line of `@oxy.so/app-preset/babel`,
`@/` resolves from `tsconfig.json` paths (Jest maps it in `moduleNameMapper`),
and SVGs are assets, not components: draw icons with `react-native-svg`.
Production exports (`NODE_ENV=production`) stay on Babel, because Noxcturnal
keeps the requires of dead platform branches and pulls native-only packages into
the web bundle. Run with `LOG_EVENTS=<file>` to see which files fall back to
Babel and why (`transform:noxcturnal:fallback`).

The app contains workspace pages, databases, comments, sharing, notifications,
and settings. It does not contain provider SDKs, provider credentials, billing
credits, or legacy chat/Clarity surfaces.
