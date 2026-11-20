# Zenzee Music - Netlify version (no server, no PC)

- `public/`  the phone app (same as the other versions)
- `netlify/functions/api.mjs`  search + audio proxy for YouTube and SoundCloud (no dependencies)
- Library, playlists, presets and local files are stored in each visitor's browser.

## Deploy
1. Put everything in this folder in a GitHub repository (files at the top level of the repo).
2. Netlify -> Add new project -> Import an existing project -> GitHub -> pick the repo -> Deploy.
   (settings come from netlify.toml, leave build command empty)
3. Open the https://....netlify.app address on the iPhone in Safari -> Share -> Add to Home Screen.

## Honest limits
- YouTube may block Netlify's servers ("Sign in to confirm you're not a bot"). SoundCloud and
  phone files are less likely to be affected. This version cannot use cookies.
- If YouTube starts failing everywhere, the client versions at the top of api.mjs may need updating.
- Netlify free plan has a monthly credit allowance; audio streaming uses bandwidth and function time.
  Watch Usage in the Netlify dashboard. Strangers using your site use your credits.
- Streams are capped at 20 MB each (fine for normal songs).
- Playlists links are not supported yet (single videos only).
