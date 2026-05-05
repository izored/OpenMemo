import { Settings, Moon, Sun, Check } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

const bgPresets = [
  { name: 'Cream', value: '#F5F0E8' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Soft Gray', value: '#F3F4F6' },
  { name: 'Warm Sand', value: '#F5F2ED' },
  { name: 'Cool Mint', value: '#F0F5F3' },
  { name: 'Pale Blush', value: '#FDF2F2' },
];

export function SettingsPage() {
  const { theme, setTheme, bgColor, setBgColor } = useAppStore();

  return (
    <div className="max-w-2xl mx-auto pt-8 pb-20">
      {/* Header */}
      <div className="flex items-center gap-4 mb-12">
        <div className="w-12 h-12 rounded-2xl bg-[#202020] flex items-center justify-center">
          <Settings size={24} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#202020]">Settings</h1>
          <p className="text-[15px] text-[#646464] mt-1">Customize your OpenMemo experience</p>
        </div>
      </div>

      {/* Appearance Section */}
      <section className="mb-12">
        <h2 className="text-sm font-bold text-[#8d8d8d] uppercase tracking-widest mb-6">
          Appearance
        </h2>

        {/* Theme Toggle */}
        <div className="bg-white rounded-3xl p-8 shadow-sm mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-[#202020] mb-1">Theme</h3>
              <p className="text-[14px] text-[#646464]">Choose between light and dark mode</p>
            </div>
            <div className="flex gap-2 bg-[#F5F0E8] rounded-full p-1">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all',
                  theme === 'light'
                    ? 'bg-white text-[#202020] shadow-sm'
                    : 'text-[#646464] hover:text-[#202020]'
                )}
              >
                <Sun size={16} />
                Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all',
                  theme === 'dark'
                    ? 'bg-[#202020] text-white shadow-sm'
                    : 'text-[#646464] hover:text-[#202020]'
                )}
              >
                <Moon size={16} />
                Dark
              </button>
            </div>
          </div>
        </div>

        {/* Background Color */}
        <div className="bg-white rounded-3xl p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#202020] mb-1">Background Color</h3>
          <p className="text-[14px] text-[#646464] mb-8">
            Pick a canvas color for your workspace
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            {bgPresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setBgColor(preset.value)}
                className="group flex flex-col items-center gap-3"
              >
                <div
                  className={cn(
                    'w-16 h-16 rounded-2xl border-2 transition-all flex items-center justify-center',
                    bgColor === preset.value
                      ? 'border-[#202020] scale-110 shadow-md'
                      : 'border-transparent hover:scale-105 shadow-sm'
                  )}
                  style={{ backgroundColor: preset.value }}
                >
                  {bgColor === preset.value && (
                    <Check size={20} className="text-[#202020]" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[13px] font-semibold transition-colors',
                    bgColor === preset.value ? 'text-[#202020]' : 'text-[#8d8d8d]'
                  )}
                >
                  {preset.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section>
        <h2 className="text-sm font-bold text-[#8d8d8d] uppercase tracking-widest mb-6">
          About
        </h2>
        <div className="bg-white rounded-3xl p-8 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#ea2804] flex items-center justify-center">
              <span className="text-white font-bold text-lg">O</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#202020]">OpenMemo</h3>
              <p className="text-[14px] text-[#646464]">Version 1.6.6</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
