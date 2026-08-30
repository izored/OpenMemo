import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { CollectionsPage } from '@/pages/CollectionsPage';
import { MemoDetail } from '@/pages/MemoDetail';
import { AskMemoPage } from '@/pages/AskMemoPage';
import { MusicPage } from '@/pages/MusicPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HiddenPage } from '@/pages/HiddenPage';
import { SpacesPage } from '@/pages/SpacesPage';
import { SpacePage } from '@/pages/SpacePage';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          {/* A library collection is a ROUTE, not just a store flag. It used to
              be the flag alone, so the URL stayed "/" while you were inside a
              collection and a refresh dropped you on the bare dashboard. Spaces
              never had that bug because /space/:id carries the id; collections
              now work the same way (ADR-001: one rule for both). */}
          <Route path="collection/:id" element={<Dashboard />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="memo/:id" element={<MemoDetail />} />
          <Route path="ask" element={<AskMemoPage />} />
          <Route path="music" element={<MusicPage />} />
          <Route path="music/:playlistId" element={<MusicPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="hidden" element={<HiddenPage />} />
          <Route path="spaces" element={<SpacesPage />} />
          <Route path="space/:id" element={<SpacePage />} />
          {/* Same fix inside a Space: the open collection belongs in the URL. */}
          <Route path="space/:id/collection/:collectionId" element={<SpacePage />} />
          {/* Per-Space hidden section (ADR-020) — same passcode + session unlock
              as /hidden, scoped to the Space via the :id param. */}
          <Route path="space/:id/hidden" element={<HiddenPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </MotionConfig>
  );
}
