# Pairing two computers, step by step

Written for a Windows desktop and a MacBook, which is the common case. Anything
below applies to any two machines.

Two situations, and they are genuinely different:

- **Same home network** — no extra software. Start here.
- **Different networks** (the laptop travels) — you need Tailscale or similar,
  because your router will not let a stranger in, and that is the router working
  correctly. Part 2.

---

## Part 1 — Both on your home Wi-Fi

### On the desktop

1. **Settings → Mesh**, turn **Mesh** on. A walkthrough opens; read it or close it.
2. Turn on **Reachable from your other computer**.
   Until this is on, openMemo listens only to itself: you can pair, and nothing
   will ever connect. Settings says **Pairing only** while it is off and
   **Ready to pair** once it is on.
3. Press **Start a Mesh**.
4. Write the 12 words down. They are also readable later under Settings → Mesh,
   but write them down anyway — this is the key to your library.

Start on the desktop rather than the laptop, on purpose. Whoever starts becomes
the **primary**, and the primary runs the Telegram bot and the heavy AI work.
That should be the machine that stays switched on.

### On the MacBook

5. **Settings → Mesh**, turn **Mesh** on.
6. Turn on **Reachable from your other computer**.
7. Press **Join a Mesh** and type the 12 words from step 4.
   A mistyped word is caught as you enter it, with the word named.

### Done

The two find each other from then on. If the desktop's device list stays empty
for a minute, see Troubleshooting below.

> **Do not press Start on both machines.** Each would make its own separate
> Mesh, and they would sit on the same network filtering each other out
> forever. openMemo now notices this and tells you — but it is easier not to do
> it.

---

## Part 2 — Different networks, with Tailscale

Your router blocks incoming connections. That is its job. So a laptop in a café
cannot reach your desktop at home, and openMemo has no server in the middle to
relay through — deliberately, since that is what "no cloud, no account" means.

Tailscale gives both machines a private address that works from anywhere, as if
they were on the same network. openMemo needs no special handling for it: a
Tailscale address is an ordinary address as far as it is concerned.

### Set up Tailscale, once

1. Install Tailscale on both machines from [tailscale.com](https://tailscale.com).
2. Sign in with the **same account** on both.
3. On each machine, note its Tailscale address — it looks like `100.x.y.z`, and
   the Tailscale app shows it. You want the **desktop's**.

### In openMemo

4. Do **all of Part 1 first**, on both machines: Mesh on, reachable on, Start on
   the desktop, Join on the MacBook with the 12 words.
   Pairing is what shares the key. It does not require the two to see each
   other, so this works from anywhere.
5. On the MacBook: **Settings → Mesh → Sync with an address**. Paste the
   desktop's Tailscale address (`100.x.y.z`) and press **Sync now**.

That is it. Discovery does not work across networks — it uses mDNS, which stops
at your subnet — so the address is typed once rather than found. Everything
after that is the same sync as on a home network.

### If you run openMemo in Docker

Port 8770 is published in `docker-compose.yml`, and Tailscale runs on the host,
so the host's Tailscale address reaches the container. Nothing extra to do.

---

## What not to do

**Do not forward port 8770 on your router.** It would work, and it puts your
sync port on the public internet. The port refuses anyone without your 12 words,
but an overlay costs you nothing and does not require being right about that
forever.

**Do not press Start twice.** Once you have paired, starting again mints a new
key and the other machine keeps the old one — they stop recognising each other
instantly, with no error on either side. openMemo now refuses and names the
device it would strand, but the button is still there for when you mean it.

**Do not put the app's own port on the internet either.** The local API has no
authentication by design. Mesh runs on its own port, serving one thing.

---

## Troubleshooting

**"No devices found."**
Normal in Docker on a home network — the bridge does not pass multicast. Use
*Sync with an address* with the other machine's local IP.

**"Found another openMemo on this network, but in a different Mesh."**
Both machines pressed Start. Press **Leave this Mesh** on one of them, then
**Join a Mesh** there with the other's code.

**"Could not reach that device."**
The address is wrong, the other machine is asleep, or its **Reachable from your
other computer** switch is off. That switch is needed on the machine being
*dialled*; on both is simplest.

**The code will not show again.**
It does now — Settings → Mesh shows all 12 words. If the panel is empty, this
device *joined* rather than started, and joining stores the key without the
words. Read them on the machine that started the Mesh.

**Starting over.**
**Leave this Mesh** on the device list. It forgets the code and the device list
on that computer and leaves your memos completely alone. The other machine keeps
its own copy and its own code — there is no server to notify, so you cannot make
it forget you.

---

Security detail, including what is encrypted and what opening the port actually
exposes: [MESH-SECURITY.md](MESH-SECURITY.md). Design: [ADR-024](ADR-024-MESH.md).
