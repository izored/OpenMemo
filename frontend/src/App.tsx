import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { CollectionsPage } from '@/pages/CollectionsPage';
import { MemoDetail } from '@/pages/MemoDetail';
import { AskMemoPage } from '@/pages/AskMemoPage';
import { MusicPage } from '@/pages/MusicPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="memo/:id" element={<MemoDetail />} />
          <Route path="ask" element={<AskMemoPage />} />
          <Route path="music" element={<MusicPage />} />
          <Route path="music/:playlistId" element={<MusicPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
