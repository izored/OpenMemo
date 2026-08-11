# Satoshi, held here rather than fetched

`--font-ui`, `--font-display` and `--font-mono` all resolve to Satoshi
(`frontend/src/styles/openmemo.css`). It is openMemo's face and always was, but
until now it arrived from `api.fontshare.com` on every page load, which meant a
local-first app could not render its own interface without a working internet
connection, and announced every launch to a CDN on the way.

Four weights, 97 KB total, declared in `frontend/src/styles/fonts.css`. Nothing
in the app requests a font over the network any more.

## Licence

Satoshi is published by the Indian Type Foundry through Fontshare under the
**ITF Free Font Licence**, which permits self-hosting and commercial use.
Fontshare's own instructions offer the download that produced these files.

`LICENSE.txt` in this directory is the licence text as published. Keep it with
the font files: that is the condition of redistributing them, and this repo is
public.

## Replacing or adding a weight

Take the URL from `https://api.fontshare.com/v2/css?f[]=satoshi@<weights>`, pull
the `.woff2` for each `@font-face` block, and name it `satoshi-<weight>.woff2`.
Then add the matching `@font-face` to `fonts.css`. Do not link the Fontshare
stylesheet back into `index.html`.
