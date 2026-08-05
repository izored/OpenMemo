# Mesh security — what happens before, during and after

Audit written 2026-08-05, against the live install. Mesh is two-way device sync
with no account, no cloud and no server in the middle, so every guarantee has to
come from the protocol and from what the app does or does not open.

The short version: **the wire is sound, the disk was not, and the listener was
bound somewhere nothing could reach.** Two of those are fixed below; the third
is now a switch you own.

---

## Before you enable it

Nothing runs. This is a hard requirement rather than a courtesy — an unused
feature must cost an install exactly nothing.

| | State when Mesh is off |
|---|---|
| API routes | every `/api/mesh/*` route 404s (`require_enabled`) |
| Listener | not started, no port bound |
| Discovery | not advertising, not browsing |
| Change triggers | not installed, so nothing is recorded |
| Tables | created empty, because their history must survive a disable |

`is_enabled()` re-reads the settings file on every call rather than caching. A
stale cache would mean sync continuing quietly after you switched it off, which
is the one outcome worth a file read to avoid.

---

## When you enable it

Three things start: the change triggers, the listener, and the mDNS
advertisement.

**What goes on the network.** The advertisement carries a *truncated hash* of
the chain id, which is itself derived from the root secret — never the root, and
never the chain id raw. It is enough for your other computer to recognise you
and useless for anything else. A stranger's openMemo on the same Wi-Fi is
filtered out on that fingerprint and never dialed.

**What the port accepts.** By default, nothing external: the listener binds
`127.0.0.1`. Settings → Mesh → *Reachable from your other computer* binds every
interface instead. That switch is the honest form of a bug this audit found —
see below.

---

## Pairing

A 12-word BIP39 code, minted on one device and typed into the other.

```
words → SHA-256 → 32-byte root
root  → HKDF-SHA256 → chain id   (identity, broadcast only as a hash)
      → HKDF-SHA256 → PSK        (authenticates every frame)
      → HKDF-SHA256 → content key (encrypts every frame)
```

Separate keys per job rather than one key used three ways, so an authenticator
and a cipher never share material. The checksum in the code means a mistyped
word fails at entry with a message, instead of becoming a pairing that silently
never connects — though note a 12-word code carries only a 4-bit checksum, so
roughly one single-word typo in sixteen still validates and simply produces a
different Mesh.

---

## While it syncs

Every frame is encrypted **and** authenticated, in that order:

1. the body is sealed with AES-256-GCM under the content key
2. an HMAC-SHA256 tag over header + ciphertext, keyed by the PSK, goes on top

The PSK tag is checked first: it is cheap, and it rejects anyone without the
pairing code before a single byte is parsed. Frames carry sequence numbers, so a
replayed or renumbered frame fails the tag rather than being processed.

Failed handshakes are throttled — five in sixty seconds and the peer is refused.
Against a 128-bit secret the point is not to be clever but to make a sustained
attempt obvious and expensive.

Revocation is enforced at handshake: a revoked device still holds a valid code,
so the check happens on the receiving side every time it connects.

The listener writes no access log, deliberately: it would record peer addresses
and frame sizes for a channel whose whole purpose is revealing as little as
possible.

---

## After you turn it off

`apply_enabled_state(False)` stops advertising, stops the listener and removes
the change triggers. A flag that left a socket listening would not be "off".

The journal and the row history stay. That is deliberate — they are your record
of what changed and what was undone, and losing them on a toggle would be a
worse surprise than keeping them.

---

## What this audit found

### 1. The root secret sat in plaintext, and briefly on the API  *(fixed)*

`mesh_secret` — the 32-byte root every key above derives from — was stored as
plain hex in `app_settings.json`, next to the theme and the upload limit. Worse,
`GET /api/settings` returned it: anything that could reach the local API could
take the root and join the Mesh.

Fixed in two parts. The key is stripped from the settings API, with a test that
fails if it ever returns. And key material now lives in an OS store
(`core/mesh/keystore.py`):

| Platform | Store |
|---|---|
| macOS | login keychain |
| Windows | DPAPI, tied to your Windows account |
| Linux | a `0600` file, described as exactly that |

Linux is the honest one: there is no keyring guaranteed to exist on a headless
box or in a container, and a dependency that fails at runtime is worse than a
file with the right permissions and a truthful label. Existing installs migrate
on first read, and the plaintext original is **deleted** rather than copied.

The 12 words move with the seed. They are the same secret in two forms — either
one reconstructs the Mesh — so protecting one and not the other would be
theatre.

### 2. The listener was unreachable, while the UI said otherwise  *(fixed)*

`DEFAULT_HOST = "127.0.0.1"`, no override, and port 8770 was never published by
`docker-compose`. Two computers could pair and could never connect. Discovery
meanwhile advertised the machine's LAN address — an address nothing was
listening on.

Settings said "this computer is listening for the other one and announcing
itself on your network". Half true, in the way that matters least.

Now: the bind address follows a setting, the port is published (which does
nothing on its own, since the listener stays on loopback until you opt in), and
the copy states which of the two states you are in — *Ready to pair* or *Pairing
only*.

### 3. Both silent pairing mistakes  *(fixed earlier, 2026-08-04)*

Start pressed on both machines, and Start pressed again after pairing. Neither
produced an error on either side. Now the first is explained by counting the
openMemos on the network that are not in this Mesh, and the second is refused
with the name of the device it would strand.

---

## Opening the port: what you are actually deciding

Turning on *Reachable from your other computer* means a socket on port 8770
accepts connections from your network.

**It does not grant access.** Every frame must carry an HMAC tag derived from
your 12-word root. Someone on your Wi-Fi can open a socket and gets rejected
without it; five tries earns a lockout. The realistic exposure is a port that
refuses everyone, plus the truncated fingerprint already in the mDNS broadcast.

**Across networks**, mDNS does not cross subnets and a direct connection needs a
route. A WireGuard-style overlay such as Tailscale solves both, and openMemo
needs no code for it: Tailscale presents as an ordinary network interface, so
binding to all interfaces covers it, and "pair by address" already accepts a
Tailscale IP. Discovery stays local; pairing by address covers the rest.

**Still open, honestly:** the transport is `ws://`, not `wss://`. The payload is
encrypted end to end under the content key, so a network observer learns frame
sizes and timing rather than content — but there is no TLS layer, and on a
hostile network that distinction is worth knowing before you open the port.
