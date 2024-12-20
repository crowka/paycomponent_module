// src/components/dashboard/Header.tsx
import { Bell, Settings, User } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="bg-white border-b border-gray-200 p-4">
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <input
            type="search"
            placeholder="Search..."
            className="w-64 px-4 py-2 border rounded-lg"
          />
        </div>
        <div className="flex items-center space-x-4">
          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <Bell className="h-5 w-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <Settings className="h-5 w-5" />
          </button>
          <button className="flex items-center space-x-2 p-2 hover:bg-gray-100 rounded-lg">
            <User className="h-5 w-5" />
            <span>Profile</span>
          </button>
        </div>
      </div>
    </header>
  );
};