import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Settings, Palette, Bell, Shield } from 'lucide-react';

export const SettingsPanel: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Palette className="w-5 h-5 text-blue-500" />
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Theme</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">Light</Button>
                <Button variant="outline" size="sm">Dark</Button>
                <Button variant="outline" size="sm">Auto</Button>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Avatar Style</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">VRoid</Button>
                <Button variant="outline" size="sm">2D</Button>
                <Button variant="outline" size="sm">None</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5 text-yellow-500" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between">
              <span className="text-sm">Daily check-in reminders</span>
              <input type="checkbox" className="w-4 h-4" />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Wellness alerts</span>
              <input type="checkbox" className="w-4 h-4" />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Memory suggestions</span>
              <input type="checkbox" className="w-4 h-4" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Data Retention</p>
              <select className="w-full p-2 border border-input rounded-lg text-sm">
                <option>Keep conversations for 30 days</option>
                <option>Keep conversations for 90 days</option>
                <option>Keep conversations forever</option>
              </select>
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm">Analytics and usage data</span>
              <input type="checkbox" className="w-4 h-4" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Personality Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Default Personality</p>
              <select className="w-full p-2 border border-input rounded-lg text-sm">
                <option value="dere">Deredere</option>
                <option value="tsun">Tsundere</option>
                <option value="kuu">Kuudere</option>
                <option value="yan">Yandere</option>
              </select>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Personality Intensity</p>
              <input
                type="range"
                min="1"
                max="10"
                defaultValue="5"
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};