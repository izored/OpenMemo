import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { MemoDetail } from '@/pages/MemoDetail';
import { MemoCastPage } from '@/pages/MemoCastPage';
import { AskMemoPage } from '@/pages/AskMemoPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="memo/:id" element={<MemoDetail />} />
          <Route path="memocast" element={<MemoCastPage />} />
          <Route path="memocast/:id" element={<MemoCastPage />} />
          <Route path="ask" element={<AskMemoPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
