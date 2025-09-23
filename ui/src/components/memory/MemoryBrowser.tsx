import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Clock, Search, Star } from 'lucide-react';

export const MemoryBrowser: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <Clock className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-semibold">Memory Browser</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Search</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search memories..."
                    className="w-full pl-10 pr-4 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Filters</p>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      Conversations
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      Important
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      Recent
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Memories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-sm mb-1">
                          Conversation about mental health strategies
                        </p>
                        <p className="text-sm text-muted-foreground mb-2">
                          Discussed coping mechanisms and daily routines...
                        </p>
                        <p className="text-xs text-muted-foreground">
                          2 hours ago • Personality: dere
                        </p>
                      </div>
                      <Star className="w-4 h-4 text-muted-foreground hover:text-yellow-500 cursor-pointer" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};