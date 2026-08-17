import type { GuideStep } from '@/components/GuideModal';
import { CookiesUpload } from '@/components/CookiesUpload';
import type { GuideId } from '@/stores/appStore';

const linkStyle = { color: 'var(--accent)', fontWeight: 500 } as const;

// "Get cookies.txt LOCALLY" — keeps the export on the user's machine.
const CHROME_EXT = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
const FIREFOX_EXT = 'https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/';

const cookiesSteps: GuideStep[] = [
  {
    id: 'why',
    title: 'Why this failed',
    body: (
      <>
        <p style={{ margin: 0 }}>
          This video is locked behind a sign-in. Sites only hand age-restricted and private
          videos to logged-in accounts. openMemo fetches on this machine, where no one is signed
          in, so YouTube turns it away.
        </p>
        <p style={{ margin: '12px 0 0' }}>
          The fix: give openMemo the cookies for <b>just this one site</b> from your browser (only
          YouTube, not your whole browsing life), so it can fetch the video as you. Bonus: once it
          is saved here it simply plays, with no "watch on the site" wall.
        </p>
      </>
    ),
  },
  {
    id: 'safety',
    title: 'How safe is this?',
    body: (
      <>
        <p style={{ margin: 0 }}>
          Fair question. A cookie file is like a key to your account, so here is exactly what
          happens to it.
        </p>
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
          {/* This guide is a static export with no hook, so it stays install-neutral.
              The exact path is on the Settings row that sends you here. */}
          <li>It lives <b>only on this machine</b>, tucked inside openMemo's own private data store, as a file named <code>yt_cookies.txt</code>. It is never put on the internet.</li>
          <li><b>Everything runs local.</b> yt-dlp is a small program sitting on this machine, not a website. It reads the cookie right here on disk.</li>
          <li>
            The <b>one and only</b> moment a cookie touches the network is when yt-dlp asks YouTube
            for the video, the very same request your browser makes when you press play.
            <br />
            <b>Nowhere else.</b>
          </li>
          <li>There is <b>no openMemo server</b>. Nothing is collected. Nothing phones home. There is simply nowhere for it to be sent.</li>
          <li>You can <b>delete it any time</b> from Settings, or right after you upload it.</li>
        </ul>
        <p
          style={{
            margin: '12px 0 0', padding: '11px 13px', borderRadius: 10,
            background: 'var(--accent-soft)', border: '1px solid var(--border)', fontSize: 15,
          }}
        >
          Still, the safest move is a <b>throwaway or secondary account</b> in the next step, so even this key opens nothing that matters.
        </p>
      </>
    ),
  },
  {
    id: 'install',
    title: 'Install a cookies exporter',
    body: (
      <>
        <p style={{ margin: 0 }}>
          You need a small browser add-on that saves your cookies to a file. Get
          {' '}<b>Get cookies.txt LOCALLY</b>. Everything stays on your machine.
        </p>
        <p style={{ margin: '10px 0 0', display: 'flex', gap: 16 }}>
          <a href={CHROME_EXT} target="_blank" rel="noopener noreferrer" style={linkStyle}>Chrome / Edge</a>
          <a href={FIREFOX_EXT} target="_blank" rel="noopener noreferrer" style={linkStyle}>Firefox</a>
        </p>
      </>
    ),
  },
  {
    id: 'signin',
    title: 'Sign in (use a spare account)',
    body: (
      <>
        <p style={{ margin: 0 }}>
          Open the site in your browser and sign in. For age-restricted YouTube, any account
          over 18 works.
        </p>
        <p
          style={{
            margin: '10px 0 0', padding: '10px 12px', borderRadius: 10,
            background: 'var(--accent-soft)', border: '1px solid var(--border)', fontSize: 12.5,
          }}
        >
          <b>Heads up:</b> cookies grant full access to that account. Use a throwaway or secondary
          account, never your main one. The file is a password. Keep it private.
        </p>
      </>
    ),
  },
  {
    id: 'export',
    title: 'Export your cookies',
    body: (
      <>
        <p style={{ margin: 0 }}>
          On the site tab, click the extension icon and export. Save the <b>cookies.txt</b> file
          somewhere you can find it.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-3)' }}>
          Your export may hold cookies for many sites, and that is fine. yt-dlp only reads the
          lines for this video's site and ignores the rest.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-3)' }}>
          Tip: export right after signing in. Cookies expire after a while, so if a download
          starts failing again later, just re-export and re-upload.
        </p>
      </>
    ),
  },
  {
    id: 'upload',
    title: 'Upload it here',
    body: (
      <p style={{ margin: 0 }}>
        Drop the <b>cookies.txt</b> below. It stays on this machine and is never shared. Then
        close this and hit <b>Try again</b>.
      </p>
    ),
    render: () => <CookiesUpload />,
  },
];

export const GUIDES: Record<GuideId, { title: string; finishLabel?: string; steps: GuideStep[] }> = {
  'yt-cookies': {
    title: 'Unlock restricted downloads',
    finishLabel: 'Close & try again',
    steps: cookiesSteps,
  },
};
